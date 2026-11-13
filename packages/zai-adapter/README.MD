# packages/zai-adapter — lib bọc zsdk (Task T1-b)

## Vai trò
Lib DUY NHẤT được phép nói chuyện với Z.AI qua `z-ai-web-dev-sdk` (zsdk):
- gọi `chat.completions.create({ stream: true, thinking })`
- biến AsyncIterable chunk thô của zsdk thành dòng event chuẩn `AdapterEvent`
- serialize `AdapterEvent` → SSE wire format (bảng contract trong `packages/protocol/PLAN.md`)
- tiện ích preserved thinking (serialize/parse ReasoningBlock)

LÀ LIB, KHÔNG PHẢI SERVICE. Worker / proxy (relay) / dev-console đều import từ đây.
**Không nơi nào khác trong repo được import `z-ai-web-dev-sdk` trực tiếp.**

## Nguồn tham khảo đã có (prototype sandbox my-project)
`src/app/api/chat/route.ts` (264 dòng) ĐÃ CHẠY ĐƯỢC: POST nhận messages → zsdk stream (glm-5.3, thinking enabled) → tách `reasoning_content`/`content` → SSE OpenAI-compatible + custom events + `[DONE]` + heartbeat 15s; lỗi truyền trong stream (`event: error`) thay vì đứt kết nối.
→ T1-b là tái cấu trúc code đó thành lib, KHÔNG viết từ đầu. Đọc prototype trước khi làm.

## API công khai (khóa sau khi T1-a xong)

```ts
import type { ChatMessage, ReasoningBlock } from '@zaiwebhub/protocol';

export type AdapterEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'answer_start' }
  | { type: 'answer_delta'; text: string }
  | { type: 'finish'; reason: string;
      usage?: { prompt_tokens: number; completion_tokens: number } }
  | { type: 'error'; error: { message: string; type: 'upstream_error' | 'cancelled' | 'unknown' } };

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;                                // mặc định 'glm-5.3'
  thinking?: { type: 'enabled' | 'disabled' };   // mặc định enabled
  clear_thinking?: boolean;                      // false = preserved thinking
  max_tokens?: number;
  temperature?: number;
}

export function streamChat(req: ChatRequest, opts?: { signal?: AbortSignal }):
  AsyncGenerator<AdapterEvent, void, undefined>;

export function toSSE(e: AdapterEvent): string;   // đúng 100% bảng contract SSE
export function serializeReasoningBlocks(blocks: ReasoningBlock[]): string;
export function parseReasoningBlocks(raw: string): ReasoningBlock[];
export const DEFAULT_MODEL = 'glm-5.3';
```

## File layout
```
src/index.ts               re-export công khai
src/stream.ts              streamChat() — vòng lặp for await trên zsdk stream
src/sse.ts                 toSSE()
src/reasoning.ts           serialize/parse ReasoningBlock
src/types.ts               AdapterEvent, ChatRequest (kế thừa @zaiwebhub/protocol)
scripts/smoke-adapter.ts   smoke test chạy zsdk thật (tái dùng từ T0-c)
```

## Quy tắc bắt buộc (kế thừa README gốc + PLANS.md)
1. Mỗi delta của zsdk → 1 AdapterEvent NGAY LẬP TỨC. Không batch, không buffer, không parse-rồi-stringify lại phần reasoning.
2. Lỗi giữa stream → yield `{ type: 'error' }` rồi kết thúc sạch. KHÔNG ném exception ra ngoài generator.
3. `opts.signal` aborted → dừng đọc zsdk, dọn dẹp, KHÔNG emit thêm event nào.
4. KHÔNG bao giờ sửa/xóa/reorder `reasoning_content`.
5. `thinking.type = 'disabled'` → không emit event thinking nào, đi thẳng answer.
6. Chunk lạ (không choices, rỗng) → bỏ qua an toàn (continue), không crash.

## DoD T1-b
- `scripts/smoke-adapter.ts`: 1 prompt ý tưởng dài (>= 200 từ), thinking enabled → in từng AdapterEvent kèm timestamp. Kết luận: stream liền mạch, đủ `thinking_delta → answer_delta → finish`; TTFB < 5s; tổng event > 50.
- `toSSE()` khớp 100% bảng contract trong `packages/protocol/PLAN.md` (test so chuỗi mẫu).
- AbortSignal hoạt động: abort giữa stream → không còn event nào, thoát sạch.
- Cập nhật trạng thái T1-b trong PLANS.md + ghi kết quả vào mục Nhật ký dưới đây.

## Nhật ký thực thi (agent ghi vào đây)
- (chưa có)
