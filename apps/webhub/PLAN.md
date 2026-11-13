# apps/webhub — PLAN (Task T3-a, T3-b, T3-c, T3-d, T3-e, T3-f)

Service DUY NHẤT user chạm tới. **Node + Hono service thuần** (quyết định D1 chốt: không Next.js, không Bun runtime).
Dev chạy port 3003 trong sandbox; prod chạy trên VPS chính.

## Endpoints
| Route | Ý nghĩa | Task |
|---|---|---|
| `POST /v1/chat/completions` | Public API OpenAI-compatible, trả SSE | T3-c |
| `WS /worker` | Kênh worker connect/register/nhận job | T3-a |
| `GET /healthz` | Health check | T3-a |

## T3-a — WS hub server + worker registry
- Upgrade WS tại `/worker`; frame đầu phải `worker.register` với `token` — token do hub cấp, **short-lived TTL ~60s** (T3-f), sai/hết hạn → close 4401.
- Registry: `{ worker_id, tenant_id, capabilities, inflight, last_heartbeat }` (D3: registry key theo tenant). Heartbeat quá 45s → coi như chết, gỡ khỏi registry.
- Nhiều worker: worker rảnh = `inflight < capabilities.concurrency`.

## T3-b — Dispatcher
- Ưu tiên DIRECT PUSH: có worker rảnh → gửi `job.dispatch` ngay (đỡ latency queue).
- Hết worker rảnh → đẩy QUEUE (MVP: in-memory). Worker phải `job.ack` trong 30s (visibility timeout); quá hạn không ack → trả job về queue cho worker khác.
- ĐÃ bắt đầu stream (đã nhận `job.chunk` đầu tiên) → KHÔNG BAO GIỜ re-dispatch (at-most-once). Chỉ đánh dấu failed.
- `job_id` uuid do hub sinh; `request_id` propagat suốt để tracing.
- Queue key có tenant prefix (D3): `tenant:{tid}:queue`.

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
  getReasoning(convId: string): Promise<ReasoningBlock[]>;    // D2: BẮT BUỘC có ngay từ đầu
  saveReasoning(convId: string, block: ReasoningBlock): Promise<void>;  // D2: BẮT BUỘC có ngay từ đầu
  getJob(jobId: string): Promise<JobRecord | null>;
  saveJob(job: JobRecord): Promise<void>;
}
```
- **D2 (chốt): interface PHẢI có `getReasoning()`/`saveReasoning()` ngay từ đầu** — kể cả khi `MemoryStateStore` chưa dùng đến (no-op). KHÔNG thêm sau.
- **D3 (chốt): mọi key PHẢI có prefix tenant** — `tenant:{tid}:conv:{cid}:reasoning`, `tenant:{tid}:conv:{cid}:messages`, `tenant:{tid}:job:{jid}`. KHÔNG dùng key không prefix.
- `MemoryStateStore` (mặc định dev — mất khi restart, chấp nhận) + `RedisStateStore` (prod; có thể stub trước, chỉ bật khi có `REDIS_URL`).
- Chỉ dùng khi: (a) `clear_thinking=false` (lưu reasoning block mới sau mỗi lượt, gắn NGUYÊN VĂN vào job tiếp theo), hoặc (b) request có `conversation_id` (lưu history).
- CẤM reorder/trim/re-encode reasoning block — model sẽ mất mạch suy luận.

## T3-e — Auth (MVP)
- Worker: token do hub cấp, TTL ngắn ~60s, gắn `tenant_id` + capability list, rotate được (chi tiết ở T3-f).
- User: env `TENANT_KEYS` = danh sách key phân tách bằng dấu phẩy. Format key: `zhb_<random>`.
- Route khác → 404. Sai auth → 401 JSON `{ error: { message } }`.

## T3-f — Security baseline (CHỐT bởi chủ dự án — DoD bắt buộc)
- **Worker token: TTL ngắn (~60s), gắn `tenant_id` + capability list, rotate được. KHÔNG dùng token static dài hạn.**
- **API key pool của Z.AI: WebHub giữ, KHÔNG đẩy xuống worker dưới dạng plaintext dài hạn.** Nếu buộc phải đẩy (vì worker gọi zsdk trực tiếp) → dùng short-lived token (~60s).
- **Job payload KHÔNG chứa secret của tenant khác** (dispatch theo tenant, không leak chéo).
- **`reasoning_content` trong StateStore: TTL 24h (configurable)**, không log ra ngoài, chỉ WebHub process được đọc trực tiếp.
- **`request_id`/`job_id` được log xuyên suốt; `reasoning_content` và API key TUYỆT ĐỐI không xuất hiện trong log** (mọi logger phải redact 2 trường này).

## DoD tổng hợp
- **T3-a**: 2 worker dev connect đồng thời; kill 1 → registry cập nhật <= 45s; token hết hạn ~60s → register bị từ chối.
- **T3-b**: kill worker TRƯỚC khi stream → job tự re-dispatch, user không thấy lỗi; kill GIỮA stream → user nhận `event:error` + `[DONE]`, không re-dispatch.
- **T3-c**: `curl -N` thấy trọn event sequence không buffer; disconnect giữa chừng → `job.cancel` gửi đi < 1s.
- **T3-d**: 2 lượt chat cùng `conversation_id` → lượt 2 nhận đúng history + reasoning blocks (kiểm tra log job payload); MỌI key state có prefix `tenant:{tid}:`.
- **T3-e**: sai key → 401; sai worker token → không register được.
- **T3-f**: grep toàn bộ log đầu ra của 1 phiên test: không có `reasoning_content`/API key nào xuất hiện; token worker trong registry hết hạn đúng TTL.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có)
