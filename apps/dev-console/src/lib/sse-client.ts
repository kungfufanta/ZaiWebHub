import type { StreamEvent } from './chat-types';

const DEFAULT_ENDPOINT = '/api/mock-chat';

/**
 * Endpoint của SSE stream.
 * - Mặc định: `/api/mock-chat` (mock emitter phát đúng wire contract của packages/protocol).
 * - Ghi đè bằng env `NEXT_PUBLIC_CHAT_ENDPOINT` (VD khi chuyển sang webhub thật ở T4-a:
 *   NEXT_PUBLIC_CHAT_ENDPOINT=/v1/chat/completions?XTransformPort=3003 — vẫn là relative URL).
 */
const CHAT_ENDPOINT = process.env.NEXT_PUBLIC_CHAT_ENDPOINT || DEFAULT_ENDPOINT;

export interface StreamChatOptions {
  messages: { role: string; content: string }[];
  model?: string;
  thinking?: boolean;
  /** Gửi { error_test: true } để mock endpoint phát event:error giữa stream. */
  errorTest?: boolean;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

/**
 * Consumes the SSE stream emitted by the chat endpoint and translates it into
 * typed events. The answer chunks follow the OpenAI-compatible format
 * (`choices[0].delta.content`) while thinking is delivered through the
 * custom `thinking_start` / `thinking_delta` events.
 */
export async function streamChat(options: StreamChatOptions): Promise<void> {
  const { messages, model, thinking = true, errorTest, signal, onEvent } = options;

  let res: Response;
  try {
    res = await fetch(CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        model,
        thinking,
        ...(errorTest ? { error_test: true } : {}),
      }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    onEvent({
      type: 'error',
      message: err instanceof Error ? err.message : `Không thể kết nối tới ${CHAT_ENDPOINT}.`,
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
    switch (eventName) {
      case 'thinking_start':
        onEvent({ type: 'thinking_start' });
        return;
      case 'thinking_delta': {
        try {
          const parsed = JSON.parse(data) as { delta?: string };
          if (typeof parsed.delta === 'string' && parsed.delta) {
            onEvent({ type: 'thinking_delta', delta: parsed.delta });
          }
        } catch {
          // ignore malformed payload
        }
        return;
      }
      case 'answer_start':
        onEvent({ type: 'answer_start' });
        return;
      case 'finish': {
        try {
          const parsed = JSON.parse(data) as { reason?: string };
          onEvent({ type: 'finish', reason: String(parsed.reason ?? 'stop') });
        } catch {
          onEvent({ type: 'finish', reason: 'stop' });
        }
        return;
      }
      case 'error': {
        try {
          const parsed = JSON.parse(data) as { error?: { message?: string } };
          onEvent({ type: 'error', message: parsed.error?.message ?? data });
        } catch {
          onEvent({ type: 'error', message: data });
        }
        return;
      }
      default: {
        // OpenAI-compatible chunk (no custom event name)
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { reasoning_content?: string; content?: string } }>;
          };
          const delta = parsed.choices?.[0]?.delta;
          if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
            onEvent({ type: 'thinking_delta', delta: delta.reasoning_content });
          }
          if (typeof delta?.content === 'string' && delta.content) {
            onEvent({ type: 'answer_delta', delta: delta.content });
          }
        } catch {
          // ignore malformed payload
        }
      }
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
