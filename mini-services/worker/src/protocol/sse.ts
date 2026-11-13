// mini-services/worker — src/protocol/sse.ts
// Port 1:1 từ ZaiWebHub packages/protocol/src/sse.ts (T1-a-1/T1-a-2 FROZEN).
// Hằng số wire pass-through + helper frame lỗi + scanner metadata (F6).
// KHÔNG import zsdk. KHÔNG I/O. Scanner CHỈ đọc metadata, KHÔNG đụng content/reasoning.
export const SSE_DONE = '[DONE]';
export const SSE_ERROR_EVENT = 'error'; // chỉ dùng cho lỗi trước-stream / hub-side (F4)

export type SseErrorType = 'upstream_error' | 'cancelled' | 'timeout' | 'quota' | 'unknown';

// Frame lỗi trước-stream — đúng contract SSE pass-through
export function buildSseErrorFrame(
  message: string,
  type: SseErrorType = 'upstream_error',
): Uint8Array {
  const encoder = new TextEncoder();
  const safeMessage = message.replace(/"/g, "'");
  const wire = `event: ${SSE_ERROR_EVENT}\ndata: {"error":{"message":"${safeMessage}","type":"${type}"}}\n\n`;
  return encoder.encode(wire);
}

export interface SseMetadata {
  done: boolean; // đã thấy `data: [DONE]`
  finish_reason?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens?: number };
}

/**
 * F6 — scanner metadata tối thiểu cho worker.
 * Worker feed() MỌI byte đi qua (bytes vẫn được relay NGUYÊN XI song song — tee),
 * scanner chỉ đọc: dòng `data: [DONE]`, `finish_reason`, `usage` trong chunk JSON cuối.
 * KHÔNG đụng vào reasoning_content/content — metadata-only scan.
 * Bộ nhớ: chỉ giữ đuôi dòng chưa hoàn tất (cap 64KB), KHÔNG giữ toàn stream.
 */
export function createSseMetadataScanner(): {
  feed: (chunk: Uint8Array) => void;
  result: () => SseMetadata;
} {
  const decoder = new TextDecoder('utf-8');
  let pending = ''; // đuôi dòng chưa kết thúc bằng \n
  const MAX_PENDING = 64 * 1024;
  const meta: SseMetadata = { done: false };
  let sawFinish = false;

  const handleLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const body = trimmed.slice(5).trim();
    if (body === SSE_DONE) {
      meta.done = true;
      return;
    }
    if (!body.startsWith('{')) return;
    // Chỉ đọc metadata — KHÔNG trích xuất content/reasoning_content
    let obj: unknown;
    try {
      obj = JSON.parse(body);
    } catch {
      return; // chunk lạ → bỏ qua an toàn
    }
    if (obj && typeof obj === 'object') {
      const o = obj as Record<string, unknown>;
      const choices = Array.isArray(o.choices) ? (o.choices as Array<Record<string, unknown>>) : [];
      const first = choices[0];
      if (first && typeof first === 'object') {
        if (typeof first.finish_reason === 'string' && first.finish_reason.length > 0) {
          meta.finish_reason = first.finish_reason;
          sawFinish = true;
        }
        if (first.usage && typeof first.usage === 'object') {
          meta.usage = first.usage as SseMetadata['usage'];
        }
      }
      if (o.usage && typeof o.usage === 'object') {
        meta.usage = o.usage as SseMetadata['usage']; // tolerant: chunk.usage ?? choices[0].usage
      }
    }
  };

  return {
    feed(chunk: Uint8Array): void {
      const text = decoder.decode(chunk, { stream: true });
      let buf = pending + text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
      pending = buf.length > MAX_PENDING ? buf.slice(-MAX_PENDING) : buf;
    },
    result(): SseMetadata {
      if (pending.length > 0) {
        handleLine(pending);
        pending = '';
      }
      // stream đóng mà chưa thấy [DONE] nhưng đã có finish_reason → vẫn coi là kết thúc hợp lệ
      return { ...meta, done: meta.done || (sawFinish && meta.finish_reason === 'stop') };
    },
  };
}
