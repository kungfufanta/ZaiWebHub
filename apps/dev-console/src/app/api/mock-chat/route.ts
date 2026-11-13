import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/mock-chat — MOCK SSE emitter cho ZaiWebHub dev-console (T1-c).
 *
 * Giả lập đúng wire contract của packages/protocol (bảng ánh xạ job.chunk → SSE):
 *   thinking chunk ĐẦU TIÊN  -> `event: thinking_start` + `data: {"message":"Thinking..."}`
 *   thinking chunk tiếp theo -> `event: thinking_delta` + `data: {"delta":"..."}`
 *   answer chunk ĐẦU TIÊN    -> `event: answer_start` + `data: {"message":"Answer:"}`
 *   answer chunk tiếp theo   -> `data: {"choices":[{"delta":{"content":"..."},"index":0,"finish_reason":null}]}`
 *   finish                   -> `event: finish` + `data: {"reason":"stop"}`
 *   error (bất cứ đâu)       -> `event: error` + `data: {"error":{"message":"...","type":"upstream_error"}}`
 *   kết thúc                 -> `data: [DONE]`
 *
 * Body: { messages: [{ role, content }], model?, thinking?, error_test? }.
 * error_test=true: sau ~2 thinking_delta phát `event: error` rồi `[DONE]`, đóng stream sạch.
 * Request.signal abort: ngừng phát, đóng stream, KHÔNG ném lỗi ra log.
 */

const DEFAULT_MODEL = 'glm-5.3';
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);
const HEARTBEAT_INTERVAL_MS = 15000;

// Nhịp phát theo spec: thinking 60-120ms/chunk (tổng ~6-10s), answer 40-80ms/chunk (tổng ~4-6s).
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

function encodeSse(name: string | null, payload: unknown): string {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return name ? `event: ${name}\ndata: ${data}\n\n` : `data: ${data}\n\n`;
}

function truncateForQuote(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}...`;
}

/**
 * Suy luận giả lập (multi-paragraph, tiếng Việt) quanh ý tưởng của tin nhắn user cuối.
 * Độ dài ~1300 ký tự -> ~100 chunk (2 từ/chunk) x ~90ms ~= 7-9s.
 */
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

/**
 * Câu trả lời giả lập (markdown, tiếng Việt): ghi chú rõ đây là MOCK + tóm tắt/trích ý tưởng user cuối.
 * Độ dài ~1050 ký tự -> ~80 chunk (2 từ/chunk) x ~60ms ~= 4.5-5.5s.
 */
function buildAnswerText(lastUserMessage: string, model: string, thinkingEnabled: boolean): string {
  const idea = truncateForQuote(lastUserMessage, 140);
  const thinkingNote = thinkingEnabled ? ' với thinking mode bật' : ' với thinking mode tắt';
  return [
    'Đây là **luồng MOCK** của ZaiWebHub dev-console — phía sau không có model thật, chỉ có một bộ phát SSE giả lập chạy đúng wire contract của `packages/protocol`: thinking → answer → finish → [DONE].',
    `Ý tưởng bạn vừa gửi: "${idea}".`,
    [
      'Tóm tắt nhanh ý tưởng (giả lập):',
      '',
      '- **Bản chất**: đang dùng ý tưởng này làm trọng tải kiểm thử để đo độ liền mạch của stream SSE qua các tầng proxy.',
      '- **Giá trị cốt lõi**: delta nhỏ phát theo nhịp 40-80ms giúp phát hiện sớm nghẽn, gộp chunk hoặc mất event ở gateway.',
      '- **Rủi ro cần đo**: TTFB, khoảng lặng giữa các event, và stream kết thúc thiếu `finish` hoặc `[DONE]`.',
      '- **Bước tiếp theo**: thay mock bằng `@zaiwebhub/zai-adapter` thật (T1-b), rồi đổi endpoint sang webhub (T4-a); UI giữ nguyên wire contract.',
    ].join('\n'),
    'Muốn xem nhánh lỗi, bật tùy chọn "Mock lỗi stream (error_test)" rồi gửi lại — mock sẽ phát `event: error` sau 2 thinking_delta và kết thúc bằng `[DONE]`.',
    `Lượt này dùng model \`${model}\`${thinkingNote}.`,
  ].join('\n\n');
}

/**
 * Chia text thành các chunk nhỏ theo số từ, GIỮ NGUYÊN mọi khoảng trắng/ký tự xuống dòng
 * (dùng tokenizer có capture group) để nối lại đúng văn bản gốc phía client.
 */
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
  const thinkingEnabled = body.thinking !== false;
  const errorTest = typeof body.error_test === 'boolean' && body.error_test;

  const lastUserMessage =
    [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const thinkingText = buildThinkingText(lastUserMessage);
  const answerText = buildAnswerText(lastUserMessage, model, thinkingEnabled);

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

      const heartbeat = setInterval(() => {
        send(': keep-alive\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      try {
        let errored = false;

        // (a)(b) thinking_start + thinking_delta*
        if (thinkingEnabled) {
          send(encodeSse('thinking_start', { message: 'Thinking...' }));
          const pieces = chunkText(thinkingText, THINKING_WORDS_PER_CHUNK);
          let sent = 0;
          for (const piece of pieces) {
            if (closed) break;
            await sleep(randMs(THINKING_CHUNK_MIN_MS, THINKING_CHUNK_MAX_MS));
            if (closed) break;
            if (!send(encodeSse('thinking_delta', { delta: piece }))) break;
            sent += 1;
            if (errorTest && sent >= ERROR_AFTER_DELTAS) {
              errored = true;
              break;
            }
          }
        }

        // (c)(d) answer_start + answer chunks (OpenAI-compatible data lines)
        if (!closed && !errored) {
          send(encodeSse('answer_start', { message: 'Answer:' }));
          const pieces = chunkText(answerText, ANSWER_WORDS_PER_CHUNK);
          let sent = 0;
          for (const piece of pieces) {
            if (closed) break;
            await sleep(randMs(ANSWER_CHUNK_MIN_MS, ANSWER_CHUNK_MAX_MS));
            if (closed) break;
            if (
              !send(
                encodeSse(null, {
                  choices: [{ delta: { content: piece }, index: 0, finish_reason: null }],
                }),
              )
            ) {
              break;
            }
            sent += 1;
            // Nhánh error_test khi thinking bị tắt: inject error sau 2 answer_delta.
            if (errorTest && !thinkingEnabled && sent >= ERROR_AFTER_DELTAS) {
              errored = true;
              break;
            }
          }
        }

        // (e) finish hoặc error
        if (closed) {
          // Client abort: không phát thêm gì, chỉ đóng sạch ở finally.
        } else if (errored) {
          send(
            encodeSse('error', {
              error: { message: ERROR_TEST_MESSAGE, type: 'upstream_error' },
            }),
          );
        } else {
          send(encodeSse('finish', { reason: 'stop' }));
        }
      } catch {
        // Không bao giờ đẩy lỗi mock-stream ra log server; coi như client đã ngắt.
        closed = true;
      } finally {
        clearInterval(heartbeat);
        // (f) [DONE] sentinel rồi đóng stream.
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
