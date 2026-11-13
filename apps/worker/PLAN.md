# apps/worker — PLAN (Task T2-a, T2-b, T4-d)

Worker chạy trong sandbox Z.AI (ephemeral, KHÔNG có inbound). Chỉ chủ động mở WS outbound ra hub và giữ kết nối.
Cùng codebase này chạy `MODE=relay` làm proxy fallback (T4-d) — KHÔNG tạo service thứ 3 riêng.

## Cấu hình env
```
HUB_URL=ws://localhost:3003/worker   # dev trong sandbox; prod: wss://hub.example.com/worker
WORKER_TOKEN=...                     # auth khi register (phải khớp env của hub)
MODE=worker | relay                  # mặc định worker
PORT=3004                            # http health check (GET /healthz)
WORKER_ID=...                        # mặc định: uuid + hostname
```

## Vòng đời (MODE=worker)
1. boot → mở WS tới `HUB_URL`.
2. gửi `worker.register` `{ capabilities: { worker_id, models: ['glm-5.3'], concurrency, protocol_version, version }, token }`.
3. heartbeat mỗi 15s (`worker.heartbeat` kèm `inflight`).
4. nhận `job.dispatch` → trả `job.ack` NGAY → chạy `streamChat()` của zai-adapter → từng AdapterEvent đổi thành `job.chunk` (seq tăng dần) → kết thúc `job.done` | `job.error`.
5. nhận `job.cancel` → `AbortController.abort()` → dừng zsdk → `job.error{ type: 'cancelled' }` → nhận job mới.
6. WS đứt → reconnect backoff 1s→2s→4s… (max 30s, có jitter). Job đang dở: hub lo (at-most-once), worker drop sạch, không tự retry.

## Backpressure (bắt buộc)
- Trước khi emit mỗi `job.chunk`: nếu `ws.bufferedAmount > 1MB` → tạm dừng đọc iterator adapter, chờ đến khi `bufferedAmount < 256KB` rồi mới đọc tiếp.
- Mục tiêu: RAM sandbox không phình khi hub/user chậm.

## MODE=relay (T4-d)
- KHÔNG import zsdk. Nhận `job.dispatch` → không chạy adapter — chỉ forward nguyên byte payload chunk giữa sandbox và hub (kịch bản: sandbox không ra được outbound tới hub trực tiếp).
- Cùng WS protocol; thêm env `RELAY_TARGET` nếu cần.

## Lệnh cấm
- Worker KHÔNG được import `z-ai-web-dev-sdk` trực tiếp — chỉ zai-adapter được gọi zsdk.
- Worker KHÔNG tự lưu state hội thoại — stateless tuyệt đối (state nằm ở WebHub, xem T3-d).

## DoD
### T2-a — WS client
- Chạy cạnh hub dev (T3-a): registry của hub thấy worker register + heartbeat đúng chu kỳ.
- Kill worker → hub đánh dấu chết trong <= 45s. Restart worker → reconnect không crash.

### T2-b — Job executor
- E2E 1 job thật qua hub dev: prompt ý tưởng dài → `job.chunk` thinking → answer → `job.done` → user SSE nhận đủ (test cùng T3-c).
- Cancel: user disconnect → `job.cancel` nhận trong < 1s → adapter dừng → `job.error(cancelled)`.
- Backpressure: tạm chặn đọc SSE phía user 30s → worker RAM ổn định, tiếp tục chạy sau khi mở.

### T4-d — relay
- 1 node relay đứng giữa worker→relay→hub: stream thông suốt zero-buffer.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có)
