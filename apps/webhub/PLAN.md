# apps/webhub — PLAN (Task T3-a, T3-b, T3-c, T3-d, T3-e)

Service DUY NHẤT user chạm tới. Bun service thuần (không phải Next.js — xem quyết định D1 trong PLANS.md).
Dev chạy port 3003 trong sandbox; prod chạy trên VPS chính.

## Endpoints
| Route | Ý nghĩa | Task |
|---|---|---|
| `POST /v1/chat/completions` | Public API OpenAI-compatible, trả SSE | T3-c |
| `WS /worker` | Kênh worker connect/register/nhận job | T3-a |
| `GET /healthz` | Health check | T3-a |

## T3-a — WS hub server + worker registry
- Upgrade WS tại `/worker`; frame đầu phải `worker.register` với `token` khớp env `WORKER_TOKEN` — sai → close 4401.
- Registry: `{ worker_id, capabilities, inflight, last_heartbeat }`. Heartbeat quá 45s → coi như chết, gỡ khỏi registry.
- Nhiều worker: worker rảnh = `inflight < capabilities.concurrency`.

## T3-b — Dispatcher
- Ưu tiên DIRECT PUSH: có worker rảnh → gửi `job.dispatch` ngay (đỡ latency queue).
- Hết worker rảnh → đẩy QUEUE (MVP: in-memory). Worker phải `job.ack` trong 30s (visibility timeout); quá hạn không ack → trả job về queue cho worker khác.
- ĐÃ bắt đầu stream (đã nhận `job.chunk` đầu tiên) → KHÔNG BAO GIỜ re-dispatch (at-most-once). Chỉ đánh dấu failed.
- `job_id` uuid do hub sinh; `request_id` propagat suốt để tracing.

## T3-c — POST /v1/chat/completions (SSE public)
- Auth (T3-e): header `Authorization: Bearer <key>` khớp env `TENANT_KEYS` → sai trả 401 JSON.
- Body: `{ messages, model?, thinking?, clear_thinking?, conversation_id?, stream: true }`.
- Header bắt buộc: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`.
- Relay ZERO-BUFFER: nhận `job.chunk` từ WS → `controller.enqueue()` NGAY, giữ nguyên byte — KHÔNG parse-rồi-stringify lại reasoning.
- Định dạng SSE đúng bảng contract trong `packages/protocol/PLAN.md` (thinking_* / answer_* / finish / error / `[DONE]`).
- User disconnect (request signal aborted):
  - job CHƯA có chunk → thu hồi/hủy khỏi dispatch (cho phép re-dispatch).
  - ĐÃ stream → gửi `job.cancel` cho worker, vẫn flush `[DONE]` cho sạch.

## T3-d — StateStore
```ts
export interface StateStore {
  getMessages(convId: string): Promise<ChatMessage[]>;
  appendMessages(convId: string, msgs: ChatMessage[]): Promise<void>;
  getReasoningBlocks(convId: string): Promise<ReasoningBlock[]>;
  appendReasoningBlock(convId: string, block: ReasoningBlock): Promise<void>;
  getJob(jobId: string): Promise<JobRecord | null>;
  saveJob(job: JobRecord): Promise<void>;
}
```
- `MemoryStateStore` (mặc định dev — mất khi restart, chấp nhận) + `RedisStateStore` (prod; có thể stub trước, chỉ bật khi có `REDIS_URL`).
- Chỉ dùng khi: (a) `clear_thinking=false` (lưu reasoning block mới sau mỗi lượt, gắn NGUYÊN VĂN vào job tiếp theo), hoặc (b) request có `conversation_id` (lưu history).
- CẤM reorder/trim/re-encode reasoning block — model sẽ mất mạch suy luận.

## T3-e — Auth (MVP)
- Worker: env `WORKER_TOKEN` chung (đủ cho MVP; sau nâng cấp per-worker token).
- User: env `TENANT_KEYS` = danh sách key phân tách bằng dấu phẩy. Format key: `zhb_<random>`.
- Route khác → 404. Sai auth → 401 JSON `{ error: { message } }`.

## DoD tổng hợp
- **T3-a**: 2 worker dev connect đồng thời; kill 1 → registry cập nhật <= 45s.
- **T3-b**: kill worker TRƯỚC khi stream → job tự re-dispatch, user không thấy lỗi; kill GIỮA stream → user nhận `event:error` + `[DONE]`, không re-dispatch.
- **T3-c**: `curl -N` thấy trọn event sequence không buffer; disconnect giữa chừng → `job.cancel` gửi đi < 1s.
- **T3-d**: 2 lượt chat cùng `conversation_id` → lượt 2 nhận đúng history + reasoning blocks (kiểm tra log job payload).
- **T3-e**: sai key → 401; sai worker token → không register được.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có)
