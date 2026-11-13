import { NextRequest } from 'next/server';
import { streamChat } from '@zaiwebhub/zai-adapter';
import type { ChatMessage } from '@zaiwebhub/protocol';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/adapter-chat (T1-c — harness gọi adapter TRỰC TIẾP, chưa qua hub).
 *
 * Pure pass-through (F4): nhận body `{ messages, model?, thinking?, clear_thinking?,
 * max_tokens?, temperature? }` → `streamChat()` của `@zaiwebhub/zai-adapter` trả
 * `ReadableStream<Uint8Array>` RAW SSE (upstream nguyên bản) → nhúng thẳng vào Response.
 * KHÔNG decode, KHÔNG sửa byte nào của adapter.
 *
 * Lỗi trước-stream theo contract adapter đã nằm TRONG stream dạng
 * `event: error\ndata: {"error":{"message":"...","type":"upstream_error"}}\n\n` —
 * route chỉ relay nguyên xi (byte-blind), như hub ở T3-c.
 *
 * zsdk phải chạy server-side (adapter import zsdk) — route dùng `runtime = 'nodejs'`.
 * Sandbox proxy KHÔNG emit `reasoning_content` (G2-4) → adapter mode trong sandbox
 * không bao giờ đạt thinking thật; nhãn: `no-reasoning (proxy)`.
 */

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

function jsonError(message: string, type: string, status: number): Response {
  return Response.json({ error: { message, type } }, { status });
}

function sanitizeMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (typeof role !== 'string' || !ALLOWED_ROLES.has(role)) continue;
    if (typeof content !== 'string' || content.trim().length === 0) continue;
    out.push({ role: role as ChatMessage['role'], content });
  }
  return out.length > 0 ? out : null;
}

/** Chấp nhận `thinking: {type}` (chuẩn) hoặc `thinking: boolean` (tiện nghi). */
function parseThinkingType(raw: unknown): { type: 'enabled' | 'disabled' } | undefined {
  if (raw && typeof raw === 'object') {
    const type = (raw as { type?: unknown }).type;
    if (type === 'enabled' || type === 'disabled') return { type };
    return undefined;
  }
  if (typeof raw === 'boolean') return { type: raw ? 'enabled' : 'disabled' };
  return undefined;
}

/** Frame lỗi dự phòng khi chính route lỗi trước khi lấy được stream từ adapter. */
function fallbackErrorStream(message: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const safe = message.replace(/"/g, "'");
  const body =
    `event: error\ndata: {"error":{"message":"${safe}","type":"upstream_error"}}\n\n` +
    'data: [DONE]\n\n';
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

export async function POST(req: NextRequest) {
  let body: {
    messages?: unknown;
    model?: unknown;
    thinking?: unknown;
    clear_thinking?: unknown;
    max_tokens?: unknown;
    temperature?: unknown;
  };
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

  // JobPayload pass-through: model là free string (F9 — không enum, không validate theo response.model).
  const request: Parameters<typeof streamChat>[0] = { messages };
  if (typeof body.model === 'string' && body.model.trim().length > 0) {
    request.model = body.model.trim();
  }
  const thinking = parseThinkingType(body.thinking);
  if (thinking) request.thinking = thinking;
  if (typeof body.clear_thinking === 'boolean') request.clear_thinking = body.clear_thinking;
  if (typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens)) {
    request.max_tokens = body.max_tokens;
  }
  if (typeof body.temperature === 'number' && Number.isFinite(body.temperature)) {
    request.temperature = body.temperature;
  }

  try {
    // AbortSignal: user bấm Stop / đóng tab → abort zsdk stream (cùng cơ chế job.cancel ở T3-c).
    const stream = streamChat(request, { signal: req.signal });
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    // Adapter contract: lỗi trước-stream nằm TRONG stream. Nếu vẫn throw (lỗi route-side),
    // phát 1 frame lỗi + [DONE] rồi đóng sạch — không đứt kết nối ôm lỗi ra log client.
    const message = err instanceof Error ? err.message : 'adapter failed before stream';
    return new Response(fallbackErrorStream(message), { headers: SSE_HEADERS });
  }
}
