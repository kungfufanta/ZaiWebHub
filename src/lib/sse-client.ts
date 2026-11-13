import type { StreamEvent, UsageInfo } from './chat-types';
import {
  endpointUrlFor,
  WEBHUB_DEV_KEY,
  WEBHUB_DEFAULT_MODEL,
  type EndpointMode,
} from './endpoints';

/**
 * SSE client — parse UPSTREAM-NATIVE wire ONLY (contract F4, packages/protocol/PLAN.md):
 *
 *   data: {...chunk OpenAI...}   → delta.reasoning_content (thinking) / delta.content (answer)
 *                                  / finish_reason (+ usage tolerant: chunk.usage ?? choices[0].usage)
 *   event: error\ndata: {...}    → lỗi trước-stream / hub-side
 *   data: [DONE]                 → stream complete
 *
 * Custom events `thinking_start/thinking_delta/answer_start/finish` ĐÃ BỎ (DEPRECATED
 * khỏi wire công khai từ Đợt 2 — dev-console tự tách thinking bằng delta.reasoning_content, F7).
 */

export interface StreamChatOptions {
  /** Chế độ endpoint (mock | adapter | webhub) — chọn trong stats bar, persisted localStorage. */
  mode: EndpointMode;
  messages: { role: string; content: string }[];
  model?: string;
  thinking?: boolean;
  /** Gửi { error_test: true } — CHỈ mode mock hỗ trợ (nhánh lỗi giả lập). */
  errorTest?: boolean;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

interface UpstreamChunk {
  choices?: Array<{
    delta?: { reasoning_content?: unknown; content?: unknown };
    finish_reason?: unknown;
    usage?: unknown;
  }>;
  usage?: unknown;
}

function parseUsage(raw: unknown): UsageInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const prompt = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : null;
  const completion = typeof u.completion_tokens === 'number' ? u.completion_tokens : null;
  if (prompt === null || completion === null) return null;
  const usage: UsageInfo = { prompt_tokens: prompt, completion_tokens: completion };
  if (typeof u.total_tokens === 'number') usage.total_tokens = u.total_tokens;
  return usage;
}

function buildRequestBody(options: StreamChatOptions): Record<string, unknown> {
  const { mode, messages, model, thinking = true } = options;
  if (mode === 'webhub') {
    // Spec T4-a: {messages, model:'glm-5.3', thinking:{type:'enabled'}, stream:true}
    return {
      messages,
      model: model || WEBHUB_DEFAULT_MODEL,
      thinking: { type: thinking ? 'enabled' : 'disabled' },
      stream: true,
    };
  }
  if (mode === 'adapter') {
    // Body chuẩn JobPayload: thinking là object {type}; thinking disabled → tường minh.
    return {
      messages,
      ...(model ? { model } : {}),
      thinking: { type: thinking ? 'enabled' : 'disabled' },
    };
  }
  // mock: boolean + error_test (nhánh lỗi giả lập chỉ có ở mock).
  return {
    messages,
    ...(model ? { model } : {}),
    thinking,
    ...(options.errorTest ? { error_test: true } : {}),
  };
}

/**
 * Consumes the SSE stream emitted by the selected endpoint and translates it into
 * typed events. Thinking/answer được tách trực tiếp từ `delta.reasoning_content`
 * / `delta.content` trong chunk OpenAI chuẩn — KHÔNG có event name riêng.
 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { mode, signal, onEvent } = options;
  const url = endpointUrlFor(mode);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (mode === 'webhub') {
    // Dev default key — PUBLIC theo thiết kế sandbox (không phải secret; xem endpoints.ts).
    headers['Authorization'] = `Bearer ${WEBHUB_DEV_KEY}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequestBody(options)),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : `Không thể kết nối tới ${url}.`,
    });
    onEvent({ type: 'stream_end' });
    return;
  }

  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data?.error?.message) message = data.error.message;
    } catch {
      // keep default message
    }
    onEvent({ type: 'error', message });
    onEvent({ type: 'stream_end' });
    return;
  }

  // Debug panel (T4-a prep): hub set X-Job-Id / X-Request-Id trước khi stream.
  onEvent({
    type: 'response_meta',
    jobId: res.headers.get('x-job-id'),
    requestId: res.headers.get('x-request-id'),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const processBlock = (block: string) => {
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0 || line.startsWith(':')) continue; // comment / keep-alive
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      onEvent({ type: 'done' });
      return;
    }
    if (eventName === 'error') {
      try {
        const parsed = JSON.parse(data) as { error?: { message?: string } };
        onEvent({ type: 'error', message: parsed.error?.message ?? data });
      } catch {
        onEvent({ type: 'error', message: data });
      }
      return;
    }

    // Chunk OpenAI chuẩn (không event name riêng trên wire F4).
    let parsed: UpstreamChunk;
    try {
      parsed = JSON.parse(data) as UpstreamChunk;
    } catch {
      return; // ignore malformed payload
    }
    const choice = parsed.choices?.[0];
    const delta = choice?.delta;
    if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
      onEvent({ type: 'thinking_delta', delta: delta.reasoning_content });
    }
    if (typeof delta?.content === 'string' && delta.content) {
      onEvent({ type: 'answer_delta', delta: delta.content });
    }
    if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
      // Usage tolerant: top-level `chunk.usage` HOẶC nhúng trong `choices[0].usage` (T0-c vs [v3]).
      const usage = parseUsage(parsed.usage) ?? parseUsage(choice.usage);
      onEvent({ type: 'finish', reason: choice.finish_reason, usage });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        processBlock(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) processBlock(buffer);
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }

  onEvent({ type: 'stream_end' });
}
