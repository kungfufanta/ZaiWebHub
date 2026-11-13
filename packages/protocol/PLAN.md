# packages/protocol — PLAN (Task T1-a)

## Mục tiêu
Hợp đồng duy nhất giữa dev-console ↔ webhub ↔ worker. Package thuần: types + zod schemas.
- KHÔNG import zsdk. KHÔNG I/O. KHÔNG phụ thuộc runtime khác.
- Mọi frame ĐỀU có zod schema; 2 bên validate trước khi dùng (không tin nhau).
- Đổi bất cứ gì trong file này → phải bump `PROTOCOL_VERSION` + cập nhật các PLAN liên quan + báo owner.

## Ghi chú BẮT BUỘC (chốt bởi chủ dự án — không bàn lại)
1. **`reasoning_blocks` là reserved field từ draft v1** — dù MVP luôn gửi `undefined` (`clear_thinking: true` mặc định, D2). KHÔNG được bỏ khỏi schema.
2. **JobPayload phải có `tenant_id` ngay từ draft** — MVP dùng `'default'`. Mọi key StateStore/Redis phải có prefix `tenant:{tenant_id}:` (D3), ví dụ: `tenant:{tid}:conv:{cid}:reasoning`, `tenant:{tid}:job:{jid}`, `tenant:{tid}:conv:{cid}:messages`. KHÔNG dùng key không prefix.
3. **Cancellation phải nằm trong protocol v1**: user disconnect → hub gửi `job.cancel {job_id}` → worker `AbortController.abort()` → zsdk stream abort → worker gửi `job.error{ type: 'cancelled' }`.
4. **T1-a-1 FROZEN NGAY theo lệnh chủ dự án Đợt 2 (không chờ G2)** — nội dung freeze xem mục bên dưới. **T1-a-2 (shape reasoning) chờ chủ dự án duyệt kết quả G2** (đã debug xong — xem mục "Kết quả G2 debug").
5. `PROTOCOL_VERSION` nằm ở `src/index.ts` (stub đã tạo ở T0-a).

## T1-a-1 — FROZEN (Đợt 2, chốt bởi chủ dự án)

| # | Hạng mục | Nội dung FROZEN |
|---|---|---|
| F1 | Transport | **WebSocket outbound** (worker connect tới hub). Text frame = JSON control message (validate zod). Binary frame = stream data. |
| F2 | Frame types | Hub→Worker: `job.dispatch`, `job.cancel`, `worker.ping`. Worker→Hub: `worker.register`, `worker.heartbeat`, `job.ack`, `job.chunk` (binary), `job.done`, `job.error`. |
| F3 | `job.cancel` | `{ type: 'job.cancel'; job_id: string; reason?: string }` — trong protocol v1. Worker abort zsdk stream (AbortController), trả `job.error{ type: 'cancelled' }`. |
| F4 | `job.chunk` payload | **Raw SSE bytes (Uint8Array) NGUYÊN XI từ upstream — KHÔNG parse, KHÔNG re-stringify.** Binary envelope: `[16B job_id (uuid bytes)][4B seq (uint32 big-endian)][SSE bytes]`. Zero-parse end-to-end: worker → hub → user đều là bytes nguyên bản. |
| F5 | Reserved fields | `reasoning_blocks?: ReasoningBlock[]` trong JobPayload (D2, MVP luôn `undefined`); `tenant_id` trong JobPayload + WorkerCapabilities; mọi key StateStore/Redis có prefix `tenant:{tenant_id}:` (D3). |

**Hệ quả F4 (zero-parse end-to-end):** SSE trả cho user = **wire format upstream nguyên bản** (OpenAI-compatible chunks + `[DONE]`), KHÔNG còn custom events `thinking_start/thinking_delta/...` trên wire công khai. Client (dev-console) tự tách thinking bằng cách đọc `delta.reasoning_content` trong chunk chuẩn OpenAI. Bảng "ánh xạ job.chunk → SSE" cũ bên dưới chuyển thành **DEPRECATED — chỉ dùng nội bộ khi debug**; wire mới xem bảng "SSE pass-through contract".

### SSE pass-through contract (thay bảng cũ)

| Nguồn bytes (zsdk response.body) | Sau khi qua worker → hub → user |
|---|---|
| `data: {"object":"chat.completion.chunk","model":"...","choices":[{"index":0,"delta":{"content":"..."}}]}\n\n` | GIỮ NGUYÊN — content đi qua `delta.content` |
| `data: {... "delta":{"reasoning_content":"..."} ...}\n\n` | GIỮ NGUYÊN — thinking đi qua `delta.reasoning_content` (chỉ xuất hiện khi upstream có; qua proxy sandbox hiện = 0 chunk) |
| chunk cuối | chứa `finish_reason: "stop"` + `usage` nhúng ngay trong chunk (đã xác nhận G2) |
| `data: [DONE]\n\n` | GIỮ NGUYÊN — kết thúc stream |
| Lỗi trước-stream (HTTP != 200, zsdk throw) | adapter/hub phát 1 frame lỗi dạng `event: error\ndata: {"error":{"message":"...","type":"upstream_error"}}\n\n` rồi đóng sạch — không throw ra ngoài pipeline |

## Phạm vi T1-a
```
src/job.ts      ChatMessage, JobPayload, ReasoningBlock, WorkerCapabilities
src/frames.ts   WS frames Hub→Worker và Worker→Hub (kèm zod schema)
src/sse.ts      SSE events tới user (tên event + payload) + hằng số tên event
src/index.ts    re-export + PROTOCOL_VERSION = 1
```

## Schema draft v1 (khóa sau khi T0-b PASS + T0-c xác nhận chunk thật của zsdk)

```ts
// src/job.ts
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning_content?: string;   // chỉ tồn tại khi preserved thinking (clear_thinking=false)
}

export interface ReasoningBlock {
  turn: number;                 // lượt hội thoại
  content: string;              // NGUYÊN VĂN reasoning_content — cấm sửa/reorder/re-encode
}

export interface JobPayload {
  job_id: string;               // hub sinh (uuid)
  request_id: string;           // tracing end-to-end, propagat mọi hop
  tenant_id: string;            // D3: MVP = 'default' — reserved từ draft v1
  conversation_id?: string;     // có = bật bộ nhớ hội thoại server-side
  model: string;                // mặc định 'glm-5.3'
  messages: ChatMessage[];
  thinking: { type: 'enabled' | 'disabled' };
  clear_thinking?: boolean;     // D2: MVP luôn true; false = preserved thinking (reserved)
  reasoning_blocks?: ReasoningBlock[];  // D2: RESERVED FIELD từ draft v1 — MVP luôn undefined
  max_tokens?: number;
  temperature?: number;
}

export interface WorkerCapabilities {
  worker_id: string;
  tenant_id: string;            // D3: worker gắn tenant từ lúc register
  models: string[];
  concurrency: number;
  protocol_version: number;
  version: string;              // build version
}

// src/frames.ts — Hub → Worker
export type HubToWorker =
  | { type: 'job.dispatch'; job: JobPayload }
  | { type: 'job.cancel'; job_id: string; reason?: string }
  | { type: 'worker.ping'; ts: number };

// src/frames.ts — Worker → Hub (JSON TEXT frames — CHỈ control; stream data đi binary riêng)
export type WorkerToHub =
  | { type: 'worker.register'; capabilities: WorkerCapabilities; token: string }
  | { type: 'worker.heartbeat'; ts: number; inflight: number }
  | { type: 'job.ack'; job_id: string }
  // job.chunk KHÔNG nằm ở đây — là WS BINARY frame theo envelope F4 (xem mục T1-a-1 FROZEN)
  | { type: 'job.done'; job_id: string; finish_reason: string;
      usage?: { prompt_tokens: number; completion_tokens: number } }
  | { type: 'job.error'; job_id: string;
      error: { message: string; type: 'upstream_error' | 'cancelled' | 'timeout' | 'quota' | 'unknown' } };

// src/sse.ts — hằng số + helpers cho wire pass-through (KHÔNG còn custom event names)
export const SSE_DONE = '[DONE]';
export const SSE_ERROR_EVENT = 'error';   // chỉ dùng cho lỗi trước-stream / hub-side (F4)
```

> **DEPRECATED (Đợt 2):** `SseEventName` cũ (`thinking_start/thinking_delta/answer_start/finish`) và bảng ánh xạ cũ bị LOẠI khỏi wire công khai theo F4 zero-parse. Giữ lại trong lịch sử file này chỉ để debug.

### Bảng ánh xạ cũ (DEPRECATED — chỉ dùng khi debug)

| Nguồn (worker chunk / AdapterEvent) | SSE ra cho user |
|---|---|
| thinking chunk ĐẦU TIÊN | `event: thinking_start` + `data: {"message":"Thinking..."}\n\n` |
| thinking chunk tiếp theo | `event: thinking_delta` + `data: {"delta":"..."}\n\n` |
| answer chunk ĐẦU TIÊN | `event: answer_start` + `data: {"message":"Answer:"}\n\n` |
| answer chunk tiếp theo | `data: {"choices":[{"delta":{"content":"..."},"index":0,"finish_reason":null}]}\n\n` |
| finish | `event: finish` + `data: {"reason":"stop"}\n\n` |
| error (bất cứ đâu) | `event: error` + `data: {"error":{"message":"...","type":"upstream_error"}}\n\n` |
| kết thúc | `data: [DONE]\n\n` |

## Kết quả G2 debug (Đợt 2 — 2026-11-13, đầu vào bắt buộc cho T1-a-2)

Phương pháp: đọc `/etc/.z-ai-config` → curl thẳng endpoint bằng đúng bộ header zsdk 0.0.18 (`Authorization: Bearer apiKey` + `X-Z-AI-From: Z` + `X-Chat-Id` + `X-User-Id` + `X-Token`). KHÔNG in key.

| # | Phát hiện | Chi tiết |
|---|---|---|
| G2-1 | baseUrl là proxy nội bộ | `/etc/.z-ai-config` → `https://internal-api.z.ai/v1` — KHÔNG phải api.z.ai công khai. zsdk load config theo thứ tự `cwd/.z-ai-config` → `~/.z-ai-config` → `/etc/.z-ai-config`; sandbox chỉ có /etc. |
| G2-2 | Key sandbox KHÔNG dùng được trên api.z.ai công khai | `https://api.z.ai/v1/chat/completions` → 404 (path sai); `https://api.z.ai/api/paas/v4/chat/completions` → **401 身份验证失败**. Outbound HTTPS/TLS tới api.z.ai OK (có response) — chỉ auth fail. |
| G2-3 | Proxy nội bộ REWRITE model | Request `model: "glm-4.6"` và `"glm-5.3"` → response (cả non-stream lẫn từng chunk stream) đều `"model": "glm-4-plus"`. glm-4.6/glm-5.3 KHÔNG được phục vụ qua proxy này — ngầm fallback glm-4-plus. |
| G2-4 | KHÔNG có reasoning qua proxy | Stream glm-5.3 + thinking enabled, prompt suy luận nhiều bước: **534 chunks → 0 chunk có `delta.reasoning_content`**, 100% `delta.content`. Non-stream cũng không có `reasoning_content`. `thinking.enabled` bị proxy bỏ qua. |
| G2-5 | zsdk 0.0.18 sạch | Grep toàn bộ package: **KHÔNG có `glm-4-plus` hay model nào hardcoded, KHÔNG có fallback model logic**. Model truyền thẳng từ caller. `thinking` mặc định `{type:'disabled'}` nếu không truyền. `stream:true` → trả thẳng `response.body` (ReadableStream<Uint8Array>, không parse). |
| G2-6 | Shape chunk thật (xác nhận) | Chunk: `{id, created, object:"chat.completion.chunk", model, choices:[{index:0, delta:{role?, content}}]}`. Chunk cuối: `finish_reason:"stop"` + **`usage` nhúng ngay trong chunk cuối**. Kết thúc: dòng `[DONE]`. |

### Hàm ý cho T1-a-2 (chờ chủ dự án duyệt)
1. Wire pass-through (F4) là lựa chọn ĐÚNG và an toàn: mọi hop đều không hiểu cũng không cần hiểu nội dung chunk.
2. `JobPayload.model` phải là **pass-through string tự do** (không enum) — vì môi trường khác nhau phục vụ model khác nhau; proxy có thể rewrite response model → KHÔNG dùng response.model để validate.
3. Thinking UI (dev-console) phải thiết kế cho 2 chế độ: (a) sandbox/proxy — không bao giờ có `reasoning_content` → panel thinking hiện placeholder/không hiện; (b) production trên api.z.ai với key thật — `delta.reasoning_content` xuất hiện chuẩn OpenAI-compatible → panel hoạt động đầy đủ.
4. `finish_reason` + `usage` nằm trong chunk cuối → `job.done` lấy từ chunk cuối, KHÔNG chờ event riêng.
5. Production WebHub (VPS) cần API key Z.AI thật gọi thẳng `https://api.z.ai/api/paas/v4` — key sandbox không thay thế được (G2-2). Xác nhận lại T3-f: key pool ở WebHub.

## DoD T1-a-1 (FROZEN — làm ngay, không chờ)
- `src/job.ts`: ChatMessage, JobPayload (có `tenant_id`, `reasoning_blocks` reserved), ReasoningBlock, WorkerCapabilities — pass-through `model: string` tự do.
- `src/frames.ts`: HubToWorker/WorkerToHub JSON control frames + zod schema + **binary envelope codec cho `job.chunk`** (encode/decode `[16B uuid][4B seq][bytes]`, roundtrip test).
- `src/sse.ts`: `SSE_DONE`, `SSE_ERROR_EVENT` + helper dựng frame lỗi trước-stream.
- `bun run lint` pass; test roundtrip: sample frame → parse(schema) → encode → parse lại khớp; binary envelope roundtrip khớp bytes.
- Cập nhật trạng thái trong PLANS.md + ghi nhật ký vào đây.

## DoD T1-a-2 (BLOCKED — chờ chủ dự án duyệt kết quả G2)
- Chốt shape `reasoning_blocks` serialization chi tiết (đã có dữ liệu G2: hiện không có reasoning qua proxy — shape chỉ quan trọng cho production).
- Xác nhận với owner: chấp nhận DEPRECATED custom events, wire = upstream nguyên bản.
- Sau khi owner duyệt → đánh dấu T1-a done trong PLANS.md.

## Nhật ký thực thi (agent ghi vào đây)
- Đợt 2 (2026-11-13): G2 debug chạy xong (6 phát hiện G2-1…G2-6 ở trên). T1-a-1 FROZEN theo lệnh chủ dự án; T1-a-2 chờ duyệt. Chưa push (chờ PAT mới tối thiểu scope).
