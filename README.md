# ZaiWebHub


Thiết kế dự án 

-Client
   -src (NextJs) -> gọi tới hạ tầng zsdk -> trả về api dạng OpenAI
-Proxy
   -src (NextJS)
-WebHub 
   -src (NextJS) -> connect các client thành 1 pulic api phân phối tới các clent trả về SSE cho user




# Reframe lại kiến trúc: đây là **Worker Pool phân tán**, không phải proxy chain

Với mô tả mới, bản chất hệ thống của bạn đã rõ hơn nhiều và nó **khác hoàn toàn** với mô hình 3 tầng proxy thông thường:

```
User ──HTTP/SSE──▶ WebHub (VPS chính, hoăc sandbox chính) ──WS/job──▶ Client (sandbox Z.AI)
                          ▲                                                │
                          │                                                ▼
                          └────── SSE back ──────────────────────    zsdk → Z.AI API
```

- **WebHub = orchestrator / load balancer / state store**, không phải proxy thuần.
- **Client = worker**, chạy trong sandbox ephemeral, có thể chết bất cứ lúc nào, **không có inbound public**.
- **Proxy = fallback egress relay** chỉ dùng khi sandbox bị chặn outbound tới WebHub.

Điều này thay đổi hoàn toàn các ưu tiên thiết kế. Dưới đây là những điểm cần giải quyết.

## 1. Transport: sandbox không có inbound → phải **pull / persistent outbound**

Vì sandbox không thể nhận kết nối từ WebHub, Client phải **chủ động mở kết nối ra ngoài** và giữ nó. Có 3 lựa chọn:

| Transport | Ưu | Nhược | Khi nào dùng |
|---|---|---|---|
| **WebSocket** (Client → WebHub) | Bidirectional, stream tự nhiên, latency thấp | Cần WebHub giữ nhiều kết nối dài; khó qua proxy nghiêm ngặt | **Mặc định** |
| **HTTP long-poll + POST callback** | Dễ qua firewall | 2 chiều phức tạp, latency cao | Khi WS bị chặn |
| **gRPC bidirectional stream** | Type-safe, flow control tốt | Khó setup sau LB | Self-host hoàn toàn |

→ **Khuyến nghị**: WebSocket làm primary. Client mở WS tới `wss://hub/api/worker`, đăng ký capabilities (models hỗ trợ, concurrency), rồi nhận job qua frame.

## 2. Job dispatch: WebHub phải có **hàng đợi**, không phải chọn client trực tiếp

Khi một request chat đến WebHub, nó **không** chọn client ngay. Thay vào đó:

```
1. User request → WebHub
2. WebHub tạo job_id, đẩy vào Redis Stream (hoặc BullMQ)
3. Một worker (Client) đang idle pull job từ stream
4. Client gọi zsdk, stream kết quả về qua WS
5. WebHub relay từng chunk → SSE cho user
```

**Tại sao dùng queue thay vì chọn client trực tiếp?**
- Sandbox có thể chết giữa lúc dispatch → job vẫn nằm trong queue, worker khác nhận.
- Load balancing tự nhiên (worker nào rảnh thì pull).
- Decouple: WebHub không cần biết chi tiết từng sandbox, chỉ cần biết "có worker đang sống".

**Nhưng có trade-off**: queue-based dispatch thêm ~10–50ms latency so với direct WS routing. Nếu latency là ưu tiên số 1, có thể dùng **direct WS push** (WebHub giữ map `worker_id → WS connection`, chọn worker rảnh và push job). Queue chỉ dùng làm fallback khi không có worker rảnh.

→ **Khuyến nghị**: hybrid — direct WS push khi có worker rảnh, queue overflow khi tất cả bận.

## 3. SSE relay: 3 hop, mỗi hop phải **chunk-by-chunk, zero buffering**

Đây là điểm dễ hỏng nhất. Chuỗi stream là:

```
Z.AI SSE → zsdk (Client) → WS frame (Client→WebHub) → HTTP SSE chunk (WebHub→User)
```

**Quy tắc bắt buộc:**

- Mỗi `delta` từ zsdk phải được `enqueue` **ngay lập tức** qua WS, không gom batch.
- WebHub nhận WS frame → `controller.enqueue()` ngay, không parse-rồi-stringify lại (sẽ làm hỏng `reasoning_content` nếu Preserved Thinking).
- Header SSE: `Cache-Control: no-transform`, `X-Accel-Buffering: no`.
- **Không** dùng middleware Next.js để xử lý body SSE — middleware có thể buffer.
- Nếu WebHub đứng sau Nginx/Cloudflare: phải tắt proxy buffering (`proxy_buffering off`), và Cloudflare cần cấu hình riêng cho SSE (thường bị buffer 4KB).

**Backpressure**: WS frame có flow control. Nếu user chậm (mobile mạng yếu), WebHub phải pause đọc WS → signal cho Client pause đọc zsdk. Nếu không, RAM WebHub sẽ phình vì buffer.

## 4. Preserved Thinking: state **phải nằm ở WebHub**, worker phải stateless

Đây là hệ quả quan trọng nhất của kiến trúc phân tán:

> Nếu bật `clear_thinking: false`, `reasoning_content` của lượt trước **phải được gửi lại nguyên vẹn** trong request tiếp theo. Nhưng worker có thể đã chết, hoặc request tiếp theo rơi vào sandbox khác.

→ **Bắt buộc**: WebHub lưu `reasoning_content` trong Redis, key theo `conversation_id`.

```
Redis: conv:{id}:reasoning_blocks → [block1, block2, ...]
```

Khi dispatch job:
1. WebHub đọc `reasoning_blocks` từ Redis.
2. Gắn vào job payload (hoặc để Client fetch qua API nội bộ).
3. Client chèn **nguyên vẹn** vào `messages` trước khi gọi zsdk.
4. Client stream về; WebHub lưu block mới vào Redis.

**Cấm kỵ**: bất kỳ tầng nào (Client, WebHub, Proxy) reorder, trim, hay re-encode `reasoning_content` sẽ làm model mất mạch suy luận.

## 5. Failure modes — đây là phần khó nhất

Sandbox ephemeral tạo ra các kịch bản hỏng đặc thù:

| Kịch bản | Xử lý |
|---|---|
| Sandbox chết **trước khi** stream bắt đầu | Job còn trong queue → worker khác nhận → user không biết gì. ✅ |
| Sandbox chết **giữa** stream | User đã thấy một nửa câu trả lời. **Không thể retry** (sẽ trùng lặp). Phải gửi `event: error` + `[DONE]` sạch sẽ, log `request_id`. ❌ không thể cứu |
| WS drop nhưng sandbox còn sống | WebHub detect WS close → coi như failure. Client reconnect sau đó sẽ thấy job đã bị hủy. |
| WebHub restart | User mất stream. Cần sticky session hoặc chấp nhận mất. Với VPS chính, dùng PM2/systemd + graceful shutdown để drain stream đang chạy. |
| Sandbox không có key/quota | Client báo capability khi register; WebHub không dispatch model đó cho nó. |

**Điểm mấu chốt**: một khi byte đầu tiên đã tới user, **không có rollback**. Thiết kế phải chấp nhận "at-most-once" cho stream đã bắt đầu.

## 6. Proxy — vai trò chính xác

Proxy chỉ cần thiết khi sandbox **không mở được outbound tới WebHub** (ví dụ: chỉ whitelist một số domain, hoặc WebHub ở IP bị chặn).

Khi đó Proxy là **bidirectional relay**:
- Proxy có public IP, sandbox reach được.
- Proxy giữ WS tới WebHub (hoặc WebHub connect tới Proxy).
- Sandbox ↔ Proxy ↔ WebHub.

**Hệ quả**:
- Thêm 1 hop → latency +10–30ms.
- Proxy phải relay SSE **zero-buffer** y như WebHub.
- Proxy phải có cơ chế auth để không thành open relay.
- **Không** đặt Proxy làm mặc định — chỉ route qua Proxy khi WebHub phát hiện sandbox không kết nối trực tiếp được (qua handshake hoặc config).

→ **Khuyến nghị**: Proxy là **cùng codebase với Client** nhưng chạy ở chế độ "relay-only" (không gọi zsdk), deploy trên VPS phụ hoặc region khác. Đừng viết service thứ 3 riêng.

## 7. Capacity & sizing trên VPS chính

WebHub giữ **mọi stream in-flight** trong RAM (buffer chunk chưa flush, state của user SSE). Ước lượng:

- 1 stream đang chạy: ~50KB–500KB buffer (tùy tốc độ user đọc và độ dài reasoning).
- 1000 concurrent stream → 50–500MB RAM chỉ cho buffer.
- Cộng thêm: WS connections (mỗi cái ~10KB kernel buffer), Redis client pool, job queue overhead.

→ VPS chính cần tối thiểu **4GB RAM** cho ~500–1000 concurrent stream. Nếu vượt, phải scale WebHub ra nhiều instance + Redis shared state, và dùng sticky routing ở LB.

**Số sandbox cần**: mỗi sandbox thường giới hạn concurrency (do tài nguyên sandbox). Nếu 1 sandbox xử lý được 5 stream song song, 1000 concurrent user cần ~200 sandbox sống đồng thời. WebHub phải có **health check + auto-scale signal** (nếu bạn kiểm soát việc tạo sandbox).

## 8. Đề xuất tối giản hóa

Từ ý tưởng ban đầu (3 service), rút gọn thành:

```
packages/
  zai-adapter/       ← lib: bọc zsdk, chuẩn hóa SSE, xử lý reasoning_content
apps/
  webhub/            ← Next.js: public API + WS server + job dispatcher + Redis state
  worker/            ← Next.js hoặc Node thuần: chạy trong sandbox, import zai-adapter,
                       mở WS tới WebHub, nhận job, stream về
  proxy/             ← cùng codebase worker, chế độ relay-only (optional)
```

- **zai-adapter là lib**, không phải service → tránh 1 hop mạng và 1 cold start.
- **worker** và **proxy** dùng chung code, khác mode.
- **webhub** là service duy nhất user thấy.

## 9. Những câu hỏi bạn cần trả lời trước khi code

1. **Sandbox có mở được WS outbound không?** (Test trước — quyết định toàn bộ transport.)
2. **Ai tạo sandbox?** Bạn kiểm soát lifecycle hay Z.AI platform? Ảnh hưởng đến health check và capacity planning.
3. **Có cần multi-tenant không?** (Nhiều user cùng dùng pool, hay mỗi user pool riêng.)
4. **Preserved Thinking có bật mặc định không?** Nếu có, Redis state là **bắt buộc từ ngày 1**, không thể thêm sau.
5. **Chấp nhận mất stream khi sandbox chết giữa chừng không?** Nếu không, cần checkpoint reasoning và cho phép user "resume" — phức tạp hơn nhiều.

## 💎 Tóm lại

- Kiến trúc đúng bản chất là **worker pool với WebSocket + queue**, không phải proxy chain.
- **State (reasoning_content) phải ở WebHub/Redis**, worker stateless — đây là điều kiện tiên quyết để load balance tự do.
- **SSE relay phải zero-buffer qua mọi hop**, và chấp nhận "at-most-once" cho stream đã bắt đầu.
- **Proxy là fallback**, không phải mặc định; dùng chung codebase với worker.
- **Điểm nghẽn thực sự** là RAM WebHub cho in-flight streams và độ ổn định của WS connection từ sandbox — không phải logic gọi Z.AI.