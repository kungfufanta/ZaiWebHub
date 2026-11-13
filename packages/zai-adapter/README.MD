# packages/zai-adapter — lib bọc zsdk (Task T1-b)

## Vai trò
Lib DUY NHẤT được phép nói chuyện với Z.AI qua `z-ai-web-dev-sdk` (zsdk):
- gọi `chat.completions.create({ stream: true, thinking })`
- **pass-through RAW SSE bytes**: trả `ReadableStream<Uint8Array>` nguyên bản từ upstream — KHÔNG parse, KHÔNG re-emit (chốt Đợt 2, xem `packages/protocol/PLAN.md` mục T1-a-1 FROZEN / F4)
- tiện ích preserved thinking (serialize/parse ReasoningBlock)

LÀ LIB, KHÔNG PHẢI SERVICE. Worker / proxy (relay) / dev-console đều import từ đây.
**Không nơi nào khác trong repo được import `z-ai-web-dev-sdk` trực tiếp.**

> **Căn cứ thực tế (G2 debug, Đợt 2):** zsdk 0.0.18 với `stream: true` đã trả thẳng `response.body` (ReadableStream<Uint8Array>) — SDK không parse, không default model, không fallback (G2-5). Adapter chỉ cần pass qua + xử lý abort + lỗi trước-stream.

## Nguồn tham khảo đã có (prototype sandbox my-project)
`src/app/api/chat/route.ts` (264 dòng) ĐÃ CHẠY ĐƯỢC: POST nhận messages → zsdk stream → SSE OpenAI-compatible + `[DONE]` + heartbeat 15s; lỗi truyền trong stream (`event: error`) thay vì đứt kết nối.
> **Lưu ý Đợt 2:** prototype parse chunk → re-emit custom events (`thinking_start/...`) là CÁCH CŨ. Adapter mới chỉ giữ nguyên lý: SSE client/AbortSignal/heartbeat/xử lý lỗi trong stream; phần parse-re-emit KHÔNG tái sử dụng (thay bằng pass-through raw bytes). Phần parse client-side của prototype (`src/lib/sse-client.ts`) vẫn tham khảo được cho dev-console đọc `delta.reasoning_content`.

## API công khai (ĐỔI theo lệnh chủ dự án Đợt 2 — thay thế bản AsyncGenerator/AdapterEvent cũ)

```ts
import type { ChatMessage, ReasoningBlock } from '@zaiwebhub/protocol';

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;                                // pass-through tự do — KHÔNG enum (G2-3: proxy rewrite model)
  thinking?: { type: 'enabled' | 'disabled' };   // mặc định enabled
  clear_thinking?: boolean;                      // false = preserved thinking
  max_tokens?: number;
  temperature?: number;
}

// CHỐT ĐỢT 2: trả RAW SSE bytes nguyên xi từ upstream (Uint8Array) — KHÔNG parse-rồi-stringify.
// Bytes đi qua worker → hub → user KHÔNG bị chạm vào ở bất kỳ hop nào (zero-parse end-to-end, F4).
export function streamChat(req: ChatRequest, opts?: { signal?: AbortSignal }):
  ReadableStream<Uint8Array>;

// tiện ích preserved thinking (giữ nguyên — dành cho production sau MVP)
export function serializeReasoningBlocks(blocks: ReasoningBlock[]): string;
export function parseReasoningBlocks(raw: string): ReasoningBlock[];
export const DEFAULT_MODEL = 'glm-5.3';   // default REQUEST field; response.model có thể bị rewrite (G2-3) — không validate theo response.model

// CHỐT ĐỢT 2-FINAL (F8): cấu hình upstream
// - UPSTREAM=proxy  (mặc định sandbox): dùng zsdk như hiện tại, config từ /etc/.z-ai-config (proxy nội bộ — KHÔNG bao giờ có reasoning_content)
// - UPSTREAM=real   (VPS): env ZAI_API_KEY + ZAI_BASE_URL (mặc định https://api.z.ai/api/paas/v4) — thinking enabled hoạt động thật
export type UpstreamMode = 'proxy' | 'real';

// CHỐT ĐỢT 2-FINAL (F6): scanner metadata tối thiểu — worker dùng để biết khi nào kết thúc job
// Pass bytes NGUYÊN XI qua (tee), đồng thời chỉ đọc metadata: finish_reason, usage, data: [DONE].
// KHÔNG đụng vào reasoning_content/content — đây là metadata-only scan, không phải parse-re-serialize.
export function createSseMetadataScanner(): {
  feed: (chunk: Uint8Array) => void;   // gọi cho MỌI byte đi qua, trước khi emit
  result: () => { done: boolean; finish_reason?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens?: number } };
};
```

> **Bỏ:** `AdapterEvent`, `AsyncGenerator<AdapterEvent>`, `toSSE()`. Wire SSE cho user giờ = upstream nguyên bản (OpenAI-compatible chunks + `[DONE]`) theo contract pass-through trong `packages/protocol/PLAN.md`. Client tự tách thinking qua `delta.reasoning_content`.

## File layout
```
src/index.ts               re-export công khai
src/stream.ts              streamChat() — pipe zsdk response.body ra ngoài, KHÔNG parse
src/reasoning.ts           serialize/parse ReasoningBlock
src/types.ts               ChatRequest (kế thừa @zaiwebhub/protocol)
scripts/smoke-adapter.ts   smoke test chạy zsdk thật (tái dùng từ T0-c)
```

## Quy tắc bắt buộc (Đợt 2 — thay bộ quy tắc AdapterEvent cũ)
1. **Pass-through tuyệt đối**: `streamChat()` pipe bytes từ zsdk response.body ra ngoài NGUYÊN XI. Không đọc/chỉnh/re-encode nội dung bytes. Không batch, không buffer thêm.
2. **Lỗi TRƯỚC stream** (HTTP != 200, zsdk throw, config thiếu): trả stream chứa đúng 1 frame lỗi `event: error\ndata: {"error":{"message":"...","type":"upstream_error"}}\n\n` rồi đóng sạch. KHÔNG throw exception ra ngoài caller.
3. **Lỗi GIỮA stream** (connection đứt giữa chừng): chỉ `controller.close()`/`cancel()` — KHÔNG chèn thêm bytes giữa SSE frame dở dang (bytes đã đi là bytes đã đi — at-most-once).
4. `opts.signal` aborted → `reader.cancel()` + dọn dẹp ngay, KHÔNG ghi thêm byte nào vào stream.
5. KHÔNG bao giờ sửa/xóa/reorder `reasoning_content` — với pass-through thì tự động đúng (không chạm vào bytes). Reasoning path là **defensive**: upstream có → relay; không có → không sinh gì thêm.
6. `thinking.type = 'disabled'` → chỉ gửi field đó cho upstream; mọi gì upstream trả đều pass nguyên xi.
7. Backpressure: dùng pipethrough/queue tự nhiên của ReadableStream — KHÔNG đọc hết vào bộ nhớ.
8. **(F9) `response.model` chỉ để LOG — không dùng để quyết định/validate bất cứ thứ gì.**
9. **(F8) UPSTREAM mode**: đọc env `UPSTREAM` (`proxy` mặc định | `real`). `real` cần `ZAI_API_KEY` (+ `ZAI_BASE_URL` mặc định `https://api.z.ai/api/paas/v4`). Nếu zsdk không cho tạo client với config inject được thì tạo client qua `new ZAI(config)` nếu class export public, nếu không thì fallback ghi config tạm — agent T1-b kiểm tra exports của zsdk 0.0.18 và chọn cách sạch nhất, ghi vào nhật ký.

## DoD T1-b
- `scripts/smoke-adapter.ts`: 1 prompt ý tưởng dài (>= 200 từ), thinking enabled → đo trên RAW bytes: TTFB < 5s; đếm số frame `data:` > 50; có dòng `data: [DONE]`; có chunk cuối chứa `finish_reason` + `usage`; ghi nhận có/không `delta.reasoning_content` (sandbox: dự kiến 0 — G2-4; production: > 0).
- Stream liền mạch không đứt: đo tổng thời gian, không có khoảng lặng bất thường (heartbeat/gap log).
- AbortSignal hoạt động: abort giữa stream → stream đóng sạch, không thêm bytes.
- Lỗi trước-stream: thử request model không tồn tại/key sai (biến env) → stream chứa đúng 1 `event: error` rồi đóng, KHÔNG throw.
- Cập nhật trạng thái T1-b trong PLANS.md + ghi kết quả vào mục Nhật ký dưới đây.

## Nhật ký thực thi (agent ghi vào đây)
- Đợt 2 (2026-11-13): API đổi thành `streamChat() → ReadableStream<Uint8Array>` theo lệnh chủ dự án (song song freeze T1-a-1). Bỏ AdapterEvent/toSSE. Căn cứ G2: zsdk đã trả raw `response.body`, proxy rewrite model thành glm-4-plus, 0 reasoning chunk trong sandbox.
- Đợt 2-final (2026-11-13): Chủ dự án duyệt T1-a-2. Thêm F8 UPSTREAM=proxy|real, F9 response.model log-only, F6 scanner API `createSseMetadataScanner()` (worker dùng gửi job.done, bytes vẫn nguyên xi). Thinking path defensive — mock-verified only cho tới khi có key thật trên VPS.
