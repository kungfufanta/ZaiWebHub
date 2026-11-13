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
- Relay ZERO-BUFFER (F4): nhận `job.chunk` (WS binary envelope `[16B job_id][4B seq][bytes]`) → decode header → `controller.enqueue()` NGAY payload bytes nguyên bản — KHÔNG parse, KHÔNG re-stringify.
- Định dạng SSE cho user = **upstream nguyên bản** (OpenAI-compatible chunks + `[DONE]`) — theo contract pass-through trong `packages/protocol/PLAN.md` (bảng cũ thinking_*/answer_* đã DEPRECATED). Lỗi trước-stream → đúng 1 frame `event: error` (hằng `SSE_ERROR_EVENT`) rồi đóng sạch.
- **(F6 Đợt 2-final) Hub BYTE-BLIND hoàn toàn**: hub KHÔNG parse SSE để tìm finish/DONE. Kết thúc job được phát hiện bởi **worker** (metadata scan) qua frame `job.done`/`job.error`. Metering/log của hub lấy từ `job.done` (finish_reason, usage). Sau `job.done` → hub tự flush `[DONE]` nếu worker chưa relay đủ, rồi đóng response.
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

## T3-f — Security baseline (CHỐT bởi chủ dự án — DoD bắt buộc; ĐÃ VERIFY đủ 5 điểm Đợt 2-final)
- **Worker token: TTL ngắn (~60s), gắn `tenant_id` + capability list, rotate được. KHÔNG dùng token static dài hạn.**
- **API key pool của Z.AI: WebHub giữ, KHÔNG đẩy xuống worker dưới dạng plaintext dài hạn.** Nếu buộc phải đẩy (vì worker gọi zsdk trực tiếp) → dùng short-lived token (~60s). *(Đợt 2-final: worker tự gọi zsdk bằng config môi trường sandbox/VPS — key pool nằm ở env VPS cho `UPSTREAM=real`; sandbox dùng config /etc có sẵn.)*
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
- **Đợt 3 (2026-11-13) — Agent 3-b: T3-a + T3-b + T3-c + T3-d + T3-e + T3-f DONE (mock-verified, probe E2E qua `/tmp/hub-ws-probe*.mjs`; KHÔNG có worker thật stream chunk trong lúc test — worker của Agent 3-a đang build song song).**

  **Files:** `src/index.ts` (Hono + serve :3003 + upgrade wiring + graceful shutdown), `src/hub/ws.ts` (T3-a: WSS noServer, upgrade chỉ `/worker` — path khác destroy; first frame phải `worker.register` valid + token TTL 60s + tenant khớp + `protocol_version` khớp, else close 4401; registry sweep 10s / heartbeat timeout 45s; duplicate worker_id → thay connection), `src/dispatch.ts` (T3-b: direct push → queue `tenant:{tid}:queue` in-memory; visibility timeout 30s/ack; max 1 re-dispatch; first chunk = streaming, cấm re-dispatch; job.cancel 2 hướng), `src/api/chat.ts` (T3-c: zod loose, `stream!==true`→400, headers SSE + X-Job-Id/X-Request-Id set TRƯỚC khi dispatch, ReadableStream enqueue raw bytes, abort signal → cancel), `src/state.ts` (T3-d: MemoryStateStore, mọi key prefix `tenant:{tid}:...`, getReasoning/saveReasoning no-op per D2), `src/auth.ts` (T3-e+f: TENANT_KEYS bearer, HMAC worker-token mint/verify timingSafeEqual, cảnh báo default secret + /internal unauthenticated lúc boot), `src/logger.ts` (JSON log, redact token/reasoning/messages/content), `package.json` (`dev` → `tsx watch src/index.ts`, thêm dep `@zaiwebhub/protocol`).

  **Verify (chạy thật, port 3003):**
  - `GET /healthz` → `{"ok":true,"service":"webhub","ts":...}`.
  - POST `/v1/chat/completions` key sai → **401** `{"error":{"message":"invalid api key"}}`; `stream:false` → **400**; route lạ → **404**.
  - Token shape: len=128, prefix `eyJ0ZW5h`, ttl=60 (log chỉ ghi shape, KHÔNG token nguyên văn).
  - Register negative ×3 (bad token / first frame không phải register / tenant mismatch) → close **4401** + reason rõ.
  - E2E probe worker: register→heartbeat→dispatch (direct push)→ack→3 binary `job.chunk`→`job.done`; `curl -N` nhận NGUYÊN bytes `data: {"choices":[{"delta":{"content":"xin chao N "}}]}` + `data: [DONE]`; headers đủ (Content-Type/Cache-Control no-cache, no-transform/X-Accel-Buffering/Connection/X-Job-Id/X-Request-Id); job_id header == job_id probe nhận.
  - Dispatcher paths: queue→drain khi worker mới register (queue_key `tenant:default:queue` trong log); worker chết TRƯỚC stream → requeue → worker khác hoàn tất, user KHÔNG thấy lỗi; worker chết GIỮA stream (7 chunks) → `event: error` + `[DONE]`, KHÔNG re-dispatch; `job.error` trước chunk → re-dispatch (attempt 2) → fail lần 2 → `event: error` cho user; visibility timeout 30s đo đúng 30.000s ×2 → fail sau lần 2; user disconnect GIỮA stream → `job.cancel {reason:'user disconnected'}` tới worker < 1s (qua `request.signal` của @hono/node-server 1.19.19); disconnect TRƯỚC chunk → job hủy sạch, frame muộn bị bỏ qua.
  - Conversation memory (T3-d): lượt 2 cùng `conversation_id` → log `message_count:2, has_history:true` (history prepend từ store; user message được lưu).
  - T3-f grep toàn bộ log phiên test: `reasoning_content` 0 hit, giá trị API key 0 hit, token chỉ xuất hiện dạng `token_prefix` 8 ký tự.
  - Typecheck: `tsc --noEmit -p apps/webhub` **PASS**. Lưu ý: `bun run typecheck` repo-wide đang FAIL ở `packages/zai-adapter` (lane Agent 3-a, đang code song song) — không thuộc phạm vi 3-b.
  - Tích hợp chéo: worker thật của Agent 3-a (protocol_version 1) đã register + ack thành công vào hub này nhiều lần trong lúc test (T2-a ↔ T3-a tương thích).

  **Deviation / open question cho owner:**
  1. **[DONE] defensive trên `job.done`**: hub byte-blind KHÔNG thể biết worker đã relay `data: [DONE]` chưa (không được parse payload — F6). Đã chọn: luôn enqueue `data: [DONE]\n\n` trước close → client LUÔN kết thúc sạch, nhưng có rủi ro `[DONE]` TRÙNG LẶP khi worker (đúng F4/F6) đã relay nó trước đó. Đề xuất: protocol v2 thêm flag `saw_done` vào `job.done` để hub append có điều kiện. Đoạn upstream `[DONE]` không được relay thì hiện tại được hub bù — assumption "worker relay trọn vẹn" sẽ verify lại khi T2-b chạy thật.
  2. `/internal/worker-token` KHÔNG xác thực ở dev — production hardening TODO (gate network/admin auth).
  3. Assistant answer KHÔNG lưu vào StateStore (hub byte-blind không trích được từ raw SSE) — bộ nhớ hội thoại MVP dựa vào client gửi đủ history (OpenAI-style). Nếu owner muốn server-side memory đầy đủ → cân nhắc cho worker kèm `answer_text` trong `job.done` (quyết định của owner, không thuộc agent này).
  4. `RedisStateStore` chưa làm (MVP Memory only) — bật khi có `REDIS_URL` (G3).
  5. Backpressure `ws.bufferedAmount` (T2-b/T4-c) chưa cài ở hub — MVP chấp nhận, theo dõi ở load test.
  6. Nhãn xác minh: toàn bộ kết quả ở đây là **mock-verified** (probe giả worker, không có upstream thật có reasoning). Mọi path reasoning (`reasoning_blocks`, getReasoning/saveReasoning) là **NOT tested** — không có reasoning thật trong sandbox (risk #1 PLANS.md).

