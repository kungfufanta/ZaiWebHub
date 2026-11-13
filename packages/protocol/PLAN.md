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
4. **KHÔNG freeze protocol trước khi T0-b (WS outbound) PASS** (gate G1). Kết quả T0-c (shape chunk thật của zsdk) là đầu vào bắt buộc của schema v1.
5. `PROTOCOL_VERSION` nằm ở `src/index.ts` (stub đã tạo ở T0-a).

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

// src/frames.ts — Worker → Hub
export type WorkerToHub =
  | { type: 'worker.register'; capabilities: WorkerCapabilities; token: string }
  | { type: 'worker.heartbeat'; ts: number; inflight: number }
  | { type: 'job.ack'; job_id: string }
  | { type: 'job.chunk'; job_id: string; seq: number;
      kind: 'thinking' | 'answer' | 'meta';
      data: { text?: string; message?: string; reason?: string } }
  | { type: 'job.done'; job_id: string; finish_reason: string;
      usage?: { prompt_tokens: number; completion_tokens: number } }
  | { type: 'job.error'; job_id: string;
      error: { message: string; type: 'upstream_error' | 'cancelled' | 'timeout' | 'quota' | 'unknown' } };

// src/sse.ts — tới user
export type SseEventName =
  | 'thinking_start' | 'thinking_delta'
  | 'answer_start'
  | 'finish' | 'error';
// answer_delta KHÔNG dùng tên event — đi bằng `data: {choices:[{delta:{content}}]}` chuẩn OpenAI
// kết thúc stream: dòng `data: [DONE]`
```

## Bảng ánh xạ job.chunk → SSE wire (CONTRACT cho T1-b và T3-c)

| Nguồn (worker chunk / AdapterEvent) | SSE ra cho user |
|---|---|
| thinking chunk ĐẦU TIÊN | `event: thinking_start` + `data: {"message":"Thinking..."}\n\n` |
| thinking chunk tiếp theo | `event: thinking_delta` + `data: {"delta":"..."}\n\n` |
| answer chunk ĐẦU TIÊN | `event: answer_start` + `data: {"message":"Answer:"}\n\n` |
| answer chunk tiếp theo | `data: {"choices":[{"delta":{"content":"..."},"index":0,"finish_reason":null}]}\n\n` |
| finish | `event: finish` + `data: {"reason":"stop"}\n\n` |
| error (bất cứ đâu) | `event: error` + `data: {"error":{"message":"...","type":"upstream_error"}}\n\n` |
| kết thúc | `data: [DONE]\n\n` |

## DoD T1-a
- `bun run lint` pass. Test roundtrip: sample frame → parse(schema) → encode → parse lại khớp.
- Bảng ánh xạ SSE trên được T1-b và T3-c dẫn chiếu — không tự chế tên event mới.
- `reasoning_blocks` + `tenant_id` có mặt trong schema (reserved theo D2/D3) dù MVP chưa dùng.
- Cập nhật trạng thái T1-a trong PLANS.md thành `done` + ghi kết quả vào đây.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có — T1-a CHỜ xác nhận chủ dự án sau T0-b/T0-c, theo lệnh Đợt 1)
