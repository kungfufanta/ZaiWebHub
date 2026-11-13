# ZaiWebHub — Master Plan & Task Board (v1)

> File này là nguồn sự thật chung cho mọi agent. Khi nhận việc, mỗi agent bắt buộc:
> 1. Đọc toàn bộ file này. 2. Đọc `PLAN.md` của package/app được giao. 3. Làm đúng phạm vi Task ID nhận được, không lan sang task khác.
> Commit theo cú pháp: `feat(T1-b): ...` / `fix(T3-c): ...` / `docs(T0-a): ...`
> Khi xong task: cập nhật cột Trạng thái ở bảng Task Board (section 6) + ghi kết quả vào mục "Nhật ký thực thi" của PLAN.md tương ứng.

---

## 1. Kiến trúc chốt lại (kế thừa README gốc — Worker Pool phân tán)

```
User ──HTTPS SSE──▶ WebHub (VPS chính / dev: bun :3003 trong sandbox)
                       │  WS outbound — worker TỰ connect ra, hub không bao giờ inbound vào sandbox
                       ▼
                    Worker (sandbox Z.AI, ephemeral) ──zsdk──▶ Z.AI API
```

| Thành phần | Bản chất | Chạy ở đâu | Vai trò |
|---|---|---|---|
| `packages/protocol` | LIB types/zod (pure) | — | Hợp đồng duy nhất mọi frame/SSE event. Không I/O, không phụ thuộc runtime. |
| `packages/zai-adapter` | LIB | import bởi worker/proxy/dev-console | Nơi DUY NHẤT được gọi zsdk. Bọc zsdk, chuẩn hóa stream, xử lý reasoning_content. |
| `apps/webhub` | bun service | VPS chính (prod) / :3003 (dev sandbox) | WS hub + dispatcher + StateStore + public SSE API. Thành phần duy nhất user chạm tới. |
| `apps/worker` | bun service | sandbox Z.AI (ephemeral, KHÔNG inbound) | WS outbound → hub, nhận job, gọi adapter, stream chunk về. |
| proxy | CÙNG codebase worker, `MODE=relay` | VPS phụ | Chỉ bật khi sandbox không ra được outbound tới hub. KHÔNG tạo service thứ 3. |
| `apps/dev-console` | Next.js | sandbox dev (:3000) | Chat UI có bộ nhớ hội thoại — kiểm chứng prompt→thinking→answer không đứt. |

**Quyết định D1 (cần owner xác nhận, không block đợt 1):** README gốc ghi webhub/worker viết bằng Next.js — v1 plan này đơn giản hóa thành **bun service thuần**. Lý do: 2 service này không có UI, bun service dễ chạy mini-service trong sandbox và deploy VPS. Chỉ `dev-console` giữ Next.js. Nếu owner veto → đóng gói lại 2 service thành Next.js custom server, giao diện protocol KHÔNG đổi.

---

## 2. Kết quả review kế hoạch gốc (README)

### Giữ nguyên — đúng bản chất
1. Worker pool + WS persistent outbound — khớp thực tế sandbox (không inbound, outbound internet đã xác nhận OK).
2. Hybrid dispatch: direct push khi có worker rảnh + queue overflow.
3. SSE relay zero-buffer qua mọi hop (`no-transform`, `X-Accel-Buffering: no`, không middleware chạm body).
4. Preserved thinking state nằm ở WebHub, worker stateless.
5. Chấp nhận at-most-once sau khi byte đầu đã tới user.
6. Adapter là LIB → bớt 1 hop mạng + 1 cold start.

### Thiếu / cần bổ sung (đã ghi vào PLAN.md tương ứng)
1. **Chưa có protocol spec** → worker/hub sẽ drift khi code song song → `packages/protocol` (T1-a) làm hợp đồng cứng.
2. **Cancellation** chưa spec: user disconnect → hub gửi `job.cancel` → worker abort zsdk bằng AbortController (T2-b, T3-c).
3. **Ack + visibility timeout** cho queue fallback: job bơ quá 30s → re-dispatch; đã stream thì cấm re-dispatch (T3-b).
4. **StateStore abstraction**: sandbox dev KHÔNG có Redis → `MemoryStateStore` (dev) + `RedisStateStore` (prod) cùng interface (T3-d).
5. **Auth tối thiểu**: worker token khi mở WS; tenant API key cho `/v1/*` (T3-e).
6. **Backpressure cơ chế cụ thể**: worker kiểm tra `ws.bufferedAmount` high-water → pause đọc adapter (T2-b).
7. **Observability**: `request_id`/`job_id` propagat toàn链 → chỉ propagat toàn chuỗi hop (mọi frame đều mang 2 ID này).

---

## 3. Topology dev trong sandbox (E2E không cần VPS)

```
Browser ──▶ Caddy :3000 ──▶ dev-console (Next.js :3000)
                               │  fetch('/v1/chat/completions?XTransformPort=3003')  ← relative URL BẮT BUỘC
                               ▼
                           webhub (bun :3003) ──SSE relay──▶ Browser
                               ▲  WS ws://localhost:3003/worker   (server-side, không qua Caddy)
                               │
                           worker (bun :3004 health) ──zsdk──▶ Z.AI
```

Quy ước gateway sandbox:
- Mọi request từ **browser** sang webhub: relative URL + `?XTransformPort=3003`. CẤM ghi port/địa chỉ tuyệt đối trong URL (kể cả WebSocket từ browser).
- Worker (process server-side) được phép connect `ws://localhost:3003/worker` trực tiếp.
- **Rủi ro verify sớm**: SSE POST dài qua Caddy/XTransformPort có bị buffer không → test ngay sau T3-c bằng `curl -N`. Nếu buffer → mở route pass-through tại dev-console `/api/relay` (vẫn zero-buffer).

---

## 4. Chốt nghiệp vụ MVP (trả lời 5 câu hỏi section 9 README gốc)

| # | Câu hỏi | Chốt cho MVP |
|---|---|---|
| 1 | Sandbox có mở được WS outbound không? | Internet outbound đã OK (clone GitHub chạy được). WS ra ngoài cần test → **T0-b**. Nếu bị chặn → fallback long-poll, KHÔNG đổi protocol (chỉ đổi transport layer của worker). |
| 2 | Ai tạo sandbox? | OPEN — owner quyết. MVP không block: scale worker bằng tay. |
| 3 | Multi-tenant? | MVP: single tenant + API key list từ env. Mọi key StateStore đặt theo `tenant_id`/`conv_id` để nâng cấp sau không phải đổi interface. |
| 4 | Preserved thinking bật mặc định? | **OFF**. Bật per-request `clear_thinking: false`. Khi bật → bắt buộc StateStore (Memory đủ cho dev, Redis cho prod). |
| 5 | Chấp nhận mất stream khi worker chết giữa chừng? | **Chấp nhận at-most-once.** Gửi `event: error` + `[DONE]` sạch, log `request_id`/`job_id`. Không retry sau byte đầu tiên. |

---

## 5. Tài sản đã có từ prototype sandbox (my-project)

Prototype **đã code xong và chạy được** trong sandbox (không chỉ là thiết kế trên giấy):

| Tài sản | Đường dẫn | Áp vào task nào |
|---|---|---|
| Route Z.AI proxy SSE: tách `reasoning_content`/`content`, event `thinking_start/thinking_delta/answer_start/finish/error`, OpenAI-compatible chunk, `[DONE]`, heartbeat 15s | `src/app/api/chat/route.ts` (264 dòng) | T1-b — tái cấu trúc thành `streamChat()` + `toSSE()` trong zai-adapter |
| SSE client parser: fetch + ReadableStream, typed StreamEvent | `src/lib/sse-client.ts` | T1-c — giữ nguyên, đổi endpoint |
| Types + metrics kiểm chứng không đứt: `ttfbMs, sawFinish, sawDone, eventCount` | `src/lib/chat-types.ts` | T1-a — tham khảo đặt tên event; T4-a — hiển thị metrics |
| Bộ nhớ hội thoại: sessions, sidebar, persist | `src/hooks/use-chat-sessions.ts` + `src/components/chat/session-sidebar.tsx` | T1-c — dùng lại nguyên cụm |
| UI chat đầy đủ: thinking-panel collapsible, event-log, stream-stats-bar, composer, message-list | `src/components/chat/*` | T1-c — copy sang dev-console |

→ Các task T1-b/T1-c chủ yếu là **tái cấu trúc + copy** từ prototype, không viết từ đầu. Ai được giao task này phải đọc code prototype trước.

---

## 6. Task Board

Trạng thái: `todo` / `in-progress` / `done` / `blocked`

| ID | Package/App | Công việc | Phụ thuộc | DoD ngắn gọn | Trạng thái |
|---|---|---|---|---|---|
| T0-a | repo | Khung monorepo: bun workspaces, tsconfig.base, stub 5 thư mục, scripts lint/build | — | `bun install` + `bun run lint` chạy OK | todo |
| T0-b | spike | Script bun test WS outbound từ sandbox ra Internet (wss echo) + đo latency/stability 5 phút | — | Có kết luận WS OK/bị chặn (gate G1) | todo |
| T0-c | spike | Script dump raw zsdk stream (glm-5.3, thinking enabled): in từng chunk JSON + timestamp | — | Chốt vị trí `reasoning_content`, `finish_reason`, keepalive (gate G2) | todo |
| T1-a | packages/protocol | Types + zod: WS frames, SSE events, JobPayload, ReasoningBlock, capabilities; `PROTOCOL_VERSION = 1` | T0-a | encode/decode roundtrip test pass | todo |
| T1-b | packages/zai-adapter | `streamChat()` AsyncGenerator + `toSSE()` + serialize/parse ReasoningBlocks + AbortSignal | T1-a (+G2) | Smoke script: prompt dài → dòng event liền mạch | todo |
| T1-c | apps/dev-console | Chat UI harness (SSE parse, Thinking collapsible, bộ nhớ hội thoại localStorage) trỏ vào adapter | T1-b | Chat nhiều lượt, history giữ đúng | todo |
| T2-a | apps/worker | WS client: connect, auth, register capabilities, heartbeat 15s, reconnect backoff | T1-a | Hub dev thấy worker register + heartbeat | todo |
| T2-b | apps/worker | Job executor: dispatch→ack→chunk*→done/error; cancel AbortController; backpressure bufferedAmount | T1-b, T2-a | E2E 1 job qua hub dev; cancel hoạt động | todo |
| T3-a | apps/webhub | WS hub server + worker registry + heartbeat timeout 45s | T1-a | 2 worker dev connect được; chết 1 → registry cập nhật | todo |
| T3-b | apps/webhub | Dispatcher: direct push ưu tiên + queue overflow + visibility timeout 30s + ack | T3-a | Kill worker trước stream → job re-dispatch OK | todo |
| T3-c | apps/webhub | POST /v1/chat/completions: SSE zero-buffer, OpenAI-compatible + custom events; user disconnect → job.cancel | T1-a | `curl -N` thấy đủ events + `[DONE]`, không buffer | todo |
| T3-d | apps/webhub | StateStore interface + MemoryStateStore + RedisStateStore stub; lưu reasoning_blocks + messages theo conv | T1-a | 2 lượt chat cùng conversation_id → lượt 2 có đúng context | todo |
| T3-e | apps/webhub | Auth: WORKER_TOKEN cho WS register; Bearer key cho `/v1/*` | T3-a, T3-c | Sai key → 401; sai token → từ chối register | todo |
| T4-a | apps/dev-console | E2E qua webhub thật (?XTransformPort=3003): panel job_id/TTFB/đếm chunk; prompt stress dài | T2-b, T3-b, T3-c | Checklist nghiệm thu trong dev-console/PLAN.md PASS | todo |
| T4-b | ops | Failure drills: kill worker giữa stream; drop WS; restart hub → user nhận event:error + [DONE] sạch | T4-a | Mọi kịch bản kết thúc sạch | todo |
| T4-c | ops | Load test N stream đồng thời (5→20): đo TTFB, RAM webhub, backpressure | T4-a | Không crash, RAM ổn định | todo |
| T4-d | apps/worker | `MODE=relay`: relay frame, không gọi zsdk; relay token riêng | T2-b | Worker→relay→hub stream thông suốt | todo |

### Decision gates
- **G1** (sau T0-b): transport = WS (mặc định) hay long-poll fallback.
- **G2** (sau T0-c): khóa chunk schema thật của zsdk — trước khi code T2-b/T3-c.
- **G3** (sau T3-d): preserved thinking có bật mặc định không → nếu có, Redis bắt buộc trên prod.

---

## 7. Lanes song song — giao agent để kịp tiến độ

- **Đợt 1 (khởi động ngay, 3 agent chạy song song):**
  - Agent A: T0-a → T1-a (khóa protocol sớm nhất có thể).
  - Agent B: T0-b + T0-c (spike — chạy trong sandbox có sẵn zsdk, tức my-project hiện tại).
  - Agent C: khung UI dev-console (T1-c phần UI với mock SSE — chưa cần adapter thật).
- **Đợt 2 (sau khi T1-a xong = G2 khóa):**
  - Agent A: T1-b (adapter lib — tái cấu trúc từ route.ts prototype).
  - Agent B: T2-a + T3-a (2 bên của WS, viết cùng lúc để test chung).
  - Agent C: T3-d + T3-e (state + auth, không đụng WS).
- **Đợt 3:**
  - Agent B: T3-b + T3-c (dispatcher + SSE public).
  - Agent C: T2-b (executor — ghép với T3-a của Agent B đợt trước).
  - Agent A: T1-c hoàn thiện (UI vào adapter thật).
- **Đợt 4 (tổng hợp):** 1 agent chính làm T4-a; agent khác T4-b; sau đó T4-c, T4-d.

**Luật bất di bất dịch:** KHÔNG ai được đổi interface trong `packages/protocol` nếu không bump `PROTOCOL_VERSION` + cập nhật PLAN + báo owner. Mọi tên event/frame lấy từ protocol, không tự chế.

---

## 8. Rủi ro & lưu ý

1. SSE POST dài qua Caddy/XTransformPort có thể bị buffer → verify ngay sau T3-c (`curl -N`); nếu buffer → route pass-through `/api/relay` tại dev-console.
2. zsdk chunk schema khác giả định → T0-c chốt trước khi code T2-b/T3-c (gate G2).
3. WebHub RAM với nhiều stream in-flight (~50–500KB/stream) → MVP chấp nhận, theo dõi ở T4-c.
4. **Bảo mật**: GitHub PAT đã dán vào hội thoại → sau khi hoàn tất nên revoke/rotate. Không bao giờ commit token vào repo; worker/hub đọc token từ env. Token cũng không được ghi vào bất kỳ file nào trong repo.
5. Tránh thêm DB (SQLite/Prisma) vào webhub state — state theo interface Memory/Redis tại T3-d.

---

## 9. Nhật ký chung (owner/agent ghi biến bản ở đây)

- [v1] Tạo bộ plan ban đầu — phân tích từ README gốc + yêu cầu owner: có giao diện test, phiên chat có bộ nhớ, kiểm chứng thinking không đứt đoạn.
