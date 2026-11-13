import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-chat — MOCK SSE emitter cho ZaiWebHub dev-console (T1-c, wire MỚI).
 *
 * ⚠️ Wire = UPSTREAM-NATIVE SSE (contract F4 — packages/protocol/PLAN.md):
 * KHÔNG còn custom events `thinking_start/thinking_delta/answer_start/finish`
 * (DEPRECATED khỏi wire công khai từ Đợt 2). Thay vào đó:
 *
 *   chunk suy luận  -> `data: {"id","object":"chat.completion.chunk","model","choices":[{"index":0,"delta":{"reasoning_content":"..."}}]}`
 *   chunk trả lời   -> `data: {...,"choices":[{"index":0,"delta":{"role":"assistant","content":"..."}}]}`
 *   chunk cuối      -> `data: {...,"choices":[{"index":0,"finish_reason":"stop","delta":{"role":"assistant","content":""}}],"usage":{"prompt_tokens":N,"completion_tokens":M,"total_tokens":N+M}}`
 *   lỗi (error_test)-> `event: error` + `data: {"error":{"message":"...","type":"upstream_error"}}` rồi `[DONE]`
 *   kết thúc        -> `data: [DONE]`
 *
 * Client (dev-console) tự tách thinking bằng `delta.reasoning_content` (F7 — panel tự hiện).
 * Mọi tuyên bố "thinking works" qua route này chỉ đạt nhãn `mock-verified` (G2-4: proxy
 * sandbox KHÔNG BAO GIỜ emit reasoning_content thật).
 *
 * Body: { messages: [{ role, content }], model?, thinking? (bool | {type}), error_test? }.
 * Request.signal abort: ngừng phát, đóng stream, KHÔNG ném lỗi ra log.
 */

const DEFAULT_MODEL = 'glm-4-plus'; // khớp hành vi proxy sandbox (G2-3: mọi model đều được phục vụ là glm-4-plus)
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const THINKING_CHUNK_MIN_MS = 60;
const THINKING_CHUNK_MAX_MS = 120;
const ANSWER_CHUNK_MIN_MS = 40;
const ANSWER_CHUNK_MAX_MS = 80;
const THINKING_WORDS_PER_CHUNK = 2;
const ANSWER_WORDS_PER_CHUNK = 2;
const ERROR_AFTER_DELTAS = 2;
const ERROR_TEST_MESSAGE = 'Mock upstream failure (test)';

interface SanitizedMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function jsonError(message: string, type: string, status: number): Response {
  return Response.json({ error: { message, type } }, { status });
}

function sanitizeMessages(raw: unknown): SanitizedMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SanitizedMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) continue;
    if (typeof content !== 'string' || content.trim().length === 0) continue;
    out.push({ role: role as SanitizedMessage['role'], content });
  }
  return out.length > 0 ? out : null;
}

/** Chấp nhận cả `thinking: boolean` (cũ) lẫn `thinking: {type:'enabled'|'disabled'}` (mới). */
function parseThinkingEnabled(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw && typeof raw === 'object') {
    const type = (raw as { type?: unknown }).type;
    if (type === 'disabled') return false;
    if (type === 'enabled') return true;
  }
  return true; // mặc định bật — khớp default của adapter
}

function truncateForQuote(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}...`;
}

/** Suy luận giả lập (multi-paragraph, tiếng Việt) — phát qua `delta.reasoning_content`. */
function buildThinkingText(lastUserMessage: string): string {
  const idea = truncateForQuote(lastUserMessage, 160);
  return [
    `Người dùng vừa đưa một ý tưởng: "${idea}". Bước đầu tiên là tách ý này thành ba lớp: bài toán thật của người dùng, giải pháp đề xuất, và kết quả có thể đo được. Nếu không tách được lớp nào, phần đó cần hỏi lại thay vì tự suy diễn.`,
    'Xét về giá trị cốt lõi: ý tưởng này chỉ đáng làm nếu nó bớt được một "nỗi đau" cụ thể mà người dùng đang chịu mỗi tuần. Cần đặt câu hỏi: ai là người dùng đầu tiên, họ đang giải bài toán này thế nào, và giải pháp thay thế hiện tại tệ ở điểm nào.',
    'Về rủi ro: phạm vi quá rộng khiến MVP kéo dài, dữ liệu đầu vào nghèo nàn làm chất lượng phản hồi thấp, và chi phí gọi model tăng nhanh nếu không giới hạn ngữ cảnh hội thoại. Cả ba rủi ro này đều đo được ngay từ tuần đầu.',
    'Về cấu trúc câu trả lời dự kiến: mở đầu bằng một câu chốt phạm vi, sau đó liệt kê các trụ cột chính kèm tiêu chí kiểm tra được, rồi nêu rủi ro lớn nhất kèm cách giảm nhẹ, cuối cùng là bước tiếp theo cụ thể cho 1-2 tuần tới.',
    'Kết luận tạm: ý tưởng khả thi ở mức thử nghiệm. Câu trả lời sẽ tóm tắt lại ý của người dùng, phân tích ngắn theo các trụ cột ở trên, và ghi chú rõ đây là luồng MOCK để người kiểm thử không nhầm với output của model thật.',
  ].join('\n\n');
}

/** Câu trả lời giả lập (markdown) — phát qua `delta.content`. */
function buildAnswerText(lastUserMessage: string, model: string, thinkingEnabled: boolean): string {
  const idea = truncateForQuote(lastUserMessage, 140);
  const thinkingNote = thinkingEnabled ? ' với thinking mode bật' : ' với thinking mode tắt';
  return [
    'Đây là **luồng MOCK** của ZaiWebHub dev-console — phía sau không có model thật, chỉ có một bộ phát SSE giả lập chạy đúng wire MỚI upstream-native (F4): chunk `delta.reasoning_content` → chunk `delta.content` → chunk `finish_reason` + `usage` → `[DONE]`.',
    `Ý tưởng bạn vừa gửi: "${idea}".`,
    [
      'Tóm tắt nhanh ý tưởng (giả lập):',
      '',
      '- **Bản chất**: đang dùng ý tưởng này làm trọng tải kiểm thử để đo độ liền mạch của stream SSE qua các tầng proxy.',
      '- **Giá trị cốt lõi**: delta nhỏ phát theo nhịp 40-80ms giúp phát hiện sớm nghẽn, gộp chunk hoặc mất event ở gateway.',
      '- **Rủi ro cần đo**: TTFB, khoảng lặng giữa các event, và stream kết thúc thiếu `finish_reason` hoặc `[DONE]`.',
      '- **Bước tiếp theo**: đổi endpoint sang `adapter` (T1-b thật) hoặc `webhub` (T4-a) bằng ô chọn chế độ trong stats bar; UI giữ nguyên wire.',
    ].join('\n'),
    'Muốn xem nhánh lỗi, bật tùy chọn "Mock lỗi stream (error_test)" rồi gửi lại — mock sẽ phát `event: error` sau 2 chunk suy luận và kết thúc bằng `[DONE]`.',
    `Lượt này dùng model \`${model}\`${thinkingNote}.`,
  ].join('\n\n');
}

/** Chia text thành các chunk nhỏ theo số từ, GIỮ NGUYÊN mọi khoảng trắng/xuống dòng. */
function chunkText(text: string, wordsPerChunk: number): string[] {
  const tokens = text.split(/(\s+)/).filter((t) => t.length > 0);
  const chunks: string[] = [];
  let buffer = '';
  let words = 0;
  for (const token of tokens) {
    buffer += token;
    if (token.trim().length > 0) {
      words += 1;
      if (words >= wordsPerChunk) {
        chunks.push(buffer);
        buffer = '';
        words = 0;
      }
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks;
}

/** Dựng 1 frame chunk OpenAI-compatible (wire F4). */
function chunkFrame(
  base: { id: string; created: number; model: string },
  delta: Record<string, unknown>,
  extra?: { finishReason?: string; usage?: Record<string, number> },
): string {
  const choice: Record<string, unknown> = { index: 0, delta };
  if (extra?.finishReason) choice.finish_reason = extra.finishReason;
  const frame: Record<string, unknown> = {
    id: base.id,
    created: base.created,
    object: 'chat.completion.chunk',
    model: base.model,
    choices: [choice],
  };
  if (extra?.usage) frame.usage = extra.usage; // usage top-level (tolerant parser đọc cả choices[0].usage)
  return `data: ${JSON.stringify(frame)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: { messages?: unknown; model?: unknown; thinking?: unknown; error_test?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError('Request body must be valid JSON.', 'bad_request', 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return jsonError(
      'Field "messages" must be a non-empty array of { role, content } objects.',
      'bad_request',
      400,
    );
  }

  const model =
    typeof body.model === 'string' && body.model.trim().length > 0
      ? body.model.trim()
      : DEFAULT_MODEL;
  const thinkingEnabled = parseThinkingEnabled(body.thinking);
  const errorTest = typeof body.error_test === 'boolean' && body.error_test;

  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const thinkingText = buildThinkingText(lastUserMessage);
  const answerText = buildAnswerText(lastUserMessage, model, thinkingEnabled);

  // Token usage giả lập (ước lượng ~4 ký tự/token) — chỉ để UI có số hiển thị.
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const promptTokens = Math.max(1, Math.round(promptChars / 4));
  const completionTokens = Math.max(
    1,
    Math.round((thinkingText.length + answerText.length) / 4),
  );
  const usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };

  const base = {
    id: `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    created: Math.floor(Date.now() / 1000),
    model,
  };

  const encoder = new TextEncoder();
  let closed = false;

  const onAbort = () => {
    closed = true;
  };
  if (req.signal.aborted) {
    closed = true;
  } else {
    req.signal.addEventListener('abort', onAbort);
  }

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const randMs = (min: number, max: number) =>
    Math.round(min + Math.random() * (max - min));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(chunk));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };

      try {
        let errored = false;

        // (a) chunk suy luận — `delta.reasoning_content` (client F7 tự hiện panel từ chunk đầu tiên)
        if (thinkingEnabled) {
          const pieces = chunkText(thinkingText, THINKING_WORDS_PER_CHUNK);
          let sent = 0;
          for (const piece of pieces) {
            if (closed) break;
            await sleep(randMs(THINKING_CHUNK_MIN_MS, THINKING_CHUNK_MAX_MS));
            if (closed) break;
            if (
              !send(
                chunkFrame(base, {
                  reasoning_content: piece,
                }),
              )
            ) {
              break;
            }
            sent += 1;
            if (errorTest && sent >= ERROR_AFTER_DELTAS) {
              errored = true;
              break;
            }
          }
        }

        // (b) chunk trả lời — `delta:{role,content}`
        if (!closed && !errored) {
          const pieces = chunkText(answerText, ANSWER_WORDS_PER_CHUNK);
          let sent = 0;
          for (const piece of pieces) {
            if (closed) break;
            await sleep(randMs(ANSWER_CHUNK_MIN_MS, ANSWER_CHUNK_MAX_MS));
            if (closed) break;
            if (
              !send(
                chunkFrame(base, {
                  role: 'assistant',
                  content: piece,
                }),
              )
            ) {
              break;
            }
            sent += 1;
            // Nhánh error_test khi thinking tắt: inject error sau 2 answer chunk.
            if (errorTest && !thinkingEnabled && sent >= ERROR_AFTER_DELTAS) {
              errored = true;
              break;
            }
          }
        }

        // (c) kết thúc: lỗi (event:error) hoặc chunk finish_reason + usage — rồi [DONE] ở finally
        if (closed) {
          // Client abort: không phát thêm gì, chỉ đóng sạch ở finally.
        } else if (errored) {
          send(
            `event: error\ndata: ${JSON.stringify({
              error: { message: ERROR_TEST_MESSAGE, type: 'upstream_error' },
            })}\n\n`,
          );
        } else {
          send(
            chunkFrame(base, { role: 'assistant', content: '' }, {
              finishReason: 'stop',
              usage,
            }),
          );
        }
      } catch {
        // Không bao giờ đẩy lỗi mock-stream ra log server; coi như client đã ngắt.
        closed = true;
      } finally {
        // (d) sentinel [DONE] rồi đóng stream (cả nhánh lỗi đều kết thúc bằng [DONE] — contract).
        send('data: [DONE]\n\n');
        try {
          controller.close();
        } catch {
          // stream đã bị client đóng
        }
        req.signal.removeEventListener('abort', onAbort);
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
