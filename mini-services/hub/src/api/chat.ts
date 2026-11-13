// apps/webhub — api/chat.ts (T3-c)
// POST /v1/chat/completions — SSE pass-through zero-buffer (F4/F6):
//   - headers SSE set NGAY TRƯỚC khi body bắt đầu (chưa biết worker nào nhận job);
//   - job.chunk (binary envelope) → decode header → enqueue payload bytes NGUYÊN XI
//     (không parse, không re-stringify — hub byte-blind hoàn toàn);
//   - kết thúc stream chỉ đến từ job.done / job.error (worker scan metadata — F6);
//   - user disconnect → dispatcher cancel logic (job.cancel cho worker nếu đang stream).
import { Hono } from 'hono';
import { z } from 'zod';
import { JobPayloadSchema, type ChatMessage, type JobPayload } from '../protocol/index';
import type { Dispatcher } from '../dispatch';
import { tenantForApiKey } from '../auth';
import { log } from '../logger';
import type { StateStore } from '../state';

// Body parse loosely — messages được sanitize thủ công trước khi build JobPayload.
const ChatRequestBodySchema = z.object({
  messages: z
    .array(z.object({ role: z.string(), content: z.unknown().optional() }))
    .min(1, 'messages must not be empty'),
  model: z.string().optional(),
  thinking: z.object({ type: z.enum(['enabled', 'disabled']) }).optional(),
  clear_thinking: z.boolean().optional(),
  conversation_id: z.string().min(1).optional(),
  stream: z.boolean().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const DEFAULT_MODEL = 'glm-5.3';

export function createChatRouter(deps: { dispatcher: Dispatcher; store: StateStore }): Hono {
  const router = new Hono();

  router.post('/v1/chat/completions', async (c) => {
    const startedAt = Date.now();
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: { message: 'invalid JSON body' } }, 400);
    }
    const parsedBody = ChatRequestBodySchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        { error: { message: `invalid request body: ${parsedBody.error.issues[0]?.message}` } },
        400,
      );
    }
    const body = parsedBody.data;

    // MVP: chỉ hỗ trợ stream:true (SSE pass-through là toàn bộ điểm của hub)
    if (body.stream !== true) {
      return c.json({ error: { message: 'stream:true is required for this endpoint (MVP)' } }, 400);
    }

    // sanitize messages: chỉ giữ role hợp lệ + content string; KHÔNG log content
    const messages: ChatMessage[] = [];
    let droppedMessages = 0;
    for (const m of body.messages) {
      if (
        (m.role === 'system' || m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string'
      ) {
        messages.push({ role: m.role, content: m.content });
      } else {
        droppedMessages += 1;
      }
    }
    if (messages.length === 0) {
      return c.json({ error: { message: 'no valid messages (role/content check failed)' } }, 400);
    }

    const tenantId = tenantForApiKey();
    const conversationId = body.conversation_id;

    // D2/D3: history prepend khi có conversation_id; reasoning_blocks reserved (MVP = [])
    if (conversationId) {
      const history = await deps.store.getMessages(tenantId, conversationId);
      if (history.length > 0) messages.unshift(...history);
    }

    const jobId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const clearThinking = body.clear_thinking ?? true;

    const payload: JobPayload = {
      job_id: jobId,
      request_id: requestId,
      tenant_id: tenantId,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      model: body.model ?? DEFAULT_MODEL,
      messages,
      thinking: body.thinking ?? { type: 'enabled' },
      clear_thinking: clearThinking,
      ...(body.max_tokens !== undefined ? { max_tokens: body.max_tokens } : {}),
      ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    };

    if (conversationId && clearThinking === false) {
      // D2 reserved path — MemoryStateStore trả [] (MVP), giữ code path cho preserved thinking
      const blocks = await deps.store.getReasoning(tenantId, conversationId);
      if (blocks.length > 0) payload.reasoning_blocks = blocks;
    }

    // Defensive: payload PHẢI pass schema protocol trước khi dispatch
    const payloadCheck = JobPayloadSchema.safeParse(payload);
    if (!payloadCheck.success) {
      return c.json(
        { error: { message: `job payload invalid: ${payloadCheck.error.issues[0]?.message}` } },
        400,
      );
    }

    // Lưu user messages vào StateStore (assistant answer KHÔNG lưu — hub byte-blind,
    // xem open question trong apps/webhub/PLAN.md)
    if (conversationId) {
      const userMsgs = messages.filter((m) => m.role === 'user');
      try {
        await deps.store.appendMessages(tenantId, conversationId, userMsgs);
      } catch (err) {
        log('warn', 'failed to persist user message', {
          job_id: jobId,
          request_id: requestId,
          error: String(err),
        });
      }
    }

    // SSE headers + stream — dựng TRƯỚC khi submit job (headers chốt trước khi biết worker).
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const sseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        // downstream cancel (đóng response) → coi như user disconnect
        deps.dispatcher.onUserDisconnect(jobId);
      },
    });

    const response = new Response(sseBody, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        Connection: 'keep-alive',
        'X-Job-Id': jobId,
        'X-Request-Id': requestId,
      },
    });

    log('info', 'chat request accepted — dispatching', {
      job_id: jobId,
      request_id: requestId,
      tenant_id: tenantId,
      conversation_id: conversationId,
      model: payload.model,
      message_count: messages.length,
      dropped_messages: droppedMessages,
      has_history: conversationId ? messages.length !== body.messages.length : false,
    });

    deps.dispatcher.submitJob(payloadCheck.data, streamController);

    // user disconnect (T3-c): abort signal → cancel logic trong dispatcher
    const signal = c.req.raw.signal;
    if (signal) {
      signal.addEventListener(
        'abort',
        () => deps.dispatcher.onUserDisconnect(jobId),
        { once: true },
      );
    }

    log('info', 'chat request handed to dispatcher', {
      job_id: jobId,
      request_id: requestId,
      setup_ms: Date.now() - startedAt,
    });
    return response;
  });

  return router;
}
