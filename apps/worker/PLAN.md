# apps/worker — PLAN (Task T2-a, T2-b, T4-d)

Worker chạy trong sandbox Z.AI (ephemeral, KHÔNG có inbound). Chỉ chủ động mở WS outbound ra hub và giữ kết nối.
Cùng codebase này chạy `MODE=relay` làm proxy fallback (T4-d) — KHÔNG tạo service thứ 3 riêng.

## Quyết định D1 (chốt bởi chủ dự án — không bàn lại)
- **Worker là Next.js app (Node runtime), KHÔNG dùng Bun.** Lý do: sandbox thường đã có Next.js sẵn, deploy prod ổn định; Bun thiếu nhiều dịch vụ và rủi ro không cần thiết.
- WS client outbound là tiến trình DÀI HẠN — KHÔNG chạy trong request handler. Boot 1 lần lúc start qua `src/instrumentation.ts` → `register()` với guard `process.env.NEXT_RUNTIME === 'nodejs'`, import động module client để không chặn build. Route handler chỉ giữ `GET /api/health` làm health check.
- **Proxy fallback (T4-d) = cùng codebase worker này, chỉ khác `MODE=relay`.**

## Worker STATELESS (bắt buộc)
- KHÔNG giữ `reasoning_content` (hoặc bất kỳ state hội thoại nào) giữa các job trong RAM/disk của worker.
- Mọi state đi qua WebHub: hub gắn `reasoning_blocks` + history vào `JobPayload` trước khi dispatch (D2/D3 — xem `apps/webhub/PLAN.md` T3-d/T3-f).
- Worker chỉ nhận job → gọi adapter → stream chunk → quên hết.

## Cấu hình env
```
HUB_URL=ws://localhost:3003/worker   # dev trong sandbox; prod: wss://hub.example.com/worker
WORKER_TOKEN=...                     # short-lived token do hub cấp (T3-f): TTL ~60s, gắn tenant_id + capabilities
TENANT_ID=default                    # D3: worker gắn tenant
MODE=worker | relay                  # mặc định worker
UPSTREAM=proxy | real                # F8: proxy (sandbox, zsdk đọc /etc/.z-ai-config) | real (VPS: ZAI_API_KEY + ZAI_BASE_URL)
PORT=3004                            # http health check (GET /api/health)
WORKER_ID=...                        # mặc định: uuid + hostname
```

## Vòng đời (MODE=worker)
1. boot (instrumentation.ts) → mở WS tới `HUB_URL`.
2. gửi `worker.register` `{ capabilities: { worker_id, tenant_id, models: ['glm-5.3'], concurrency, protocol_version, version }, token }`.
3. heartbeat mỗi 15s (`worker.heartbeat` kèm `inflight`).
4. nhận `job.dispatch` → trả `job.ack` NGAY → chạy `streamChat()` của zai-adapter → pipe NGUYÊN bytes (ReadableStream<Uint8Array>) thành `job.chunk` WS binary envelope `[16B job_id][4B seq][SSE bytes]` (KHÔNG parse — F4 Đợt 2). **Song song (F6): feed mọi byte vào `createSseMetadataScanner()` của protocol** — scanner chỉ đọc `finish_reason`/`usage`/`data: [DONE]`, KHÔNG đụng content/reasoning → khi scanner thấy kết thúc → gửi `job.done` (finish_reason + usage từ scanner). Nếu stream đóng mà KHÔNG có `[DONE]`/`finish_reason` (lỗi giữa chừng) → `job.error`.
5. nhận `job.cancel` → `AbortController.abort()` → dừng zsdk → `job.error{ type: 'cancelled' }` → nhận job mới.
6. WS đứt → reconnect backoff 1s→2s→4s… (max 30s, có jitter). Job đang dở: hub lo (at-most-once), worker drop sạch, không tự retry.

## Backpressure (bắt buộc)
- Trước khi emit mỗi `job.chunk`: nếu `ws.bufferedAmount > 1MB` → tạm dừng đọc ReadableStream của adapter, chờ đến khi `bufferedAmount < 256KB` rồi mới đọc tiếp.
- Mục tiêu: RAM sandbox không phình khi hub/user chậm.

## MODE=relay (T4-d)
- KHÔNG import zsdk. Nhận `job.dispatch` → không chạy adapter — chỉ forward nguyên byte payload chunk giữa sandbox và hub (kịch bản: sandbox không ra được outbound tới hub trực tiếp).
- Cùng WS protocol; thêm env `RELAY_TARGET` nếu cần.

## Lệnh cấm
- Worker KHÔNG được import `z-ai-web-dev-sdk` trực tiếp — chỉ zai-adapter được gọi zsdk.
- Worker KHÔNG tự lưu state hội thoại — stateless tuyệt đối (state nằm ở WebHub, xem T3-d).
- Worker KHÔNG được ghi API key Z.AI xuống disk/env dài hạn — nhận short-lived token qua job handshake nếu cơ chế đó được bật (T3-f).
- KHÔNG dùng Bun runtime (D1). Bun chỉ được dùng làm package manager.

## DoD
### T2-a — WS client
- Chạy cạnh hub dev (T3-a): registry của hub thấy worker register + heartbeat đúng chu kỳ.
- Kill worker → hub đánh dấu chết trong <= 45s. Restart worker → reconnect không crash.

### T2-b — Job executor
- E2E 1 job thật qua hub dev: prompt ý tưởng dài → `job.chunk` raw SSE bytes nguyên bản → `job.done` → user SSE nhận nguyên bản upstream (test cùng T3-c).
- Cancel: user disconnect → `job.cancel` nhận trong < 1s → adapter dừng → `job.error(cancelled)`.
- Backpressure: tạm chặn đọc SSE phía user 30s → worker RAM ổn định, tiếp tục chạy sau khi mở.

### T4-d — relay
- 1 node relay đứng giữa worker→relay→hub: stream thông suốt zero-buffer.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có)
