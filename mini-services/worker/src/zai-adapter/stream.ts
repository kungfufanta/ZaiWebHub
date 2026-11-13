// mini-services/worker — src/zai-adapter/stream.ts
// Port 1:1 từ ZaiWebHub packages/zai-adapter/src/stream.ts (T1-b), chạy trong Bun mini-service.
// streamChat(): trả ReadableStream<Uint8Array> RAW pass-through từ zsdk response.body (F4 — zero-parse).
// - KHÔNG decode, KHÔNG transform, KHÔNG buffer cả stream. Mỗi byte upstream = 1 byte ra ngoài.
// - F8: UPSTREAM=proxy (mặc định, zsdk đọc /etc/.z-ai-config) | real (ZAI_API_KEY + ZAI_BASE_URL).
// - zsdk CHỈ được import ở backend (mini-service) — đúng quy tắc sandbox.
// - Lỗi TRƯỚC stream → stream chứa đúng 1 buildSseErrorFrame() rồi đóng sạch. KHÔNG throw ra caller.
// - Lỗi GIỮA stream → chỉ đóng sạch, KHÔNG chèn bytes giữa SSE frame dở dang (at-most-once).
// - opts.signal aborted → cancel reader + đóng sạch, không còn byte nào đi ra.
import { buildSseErrorFrame } from '../protocol';
import {
  DEFAULT_MODEL,
  type ChatRequest,
  type StreamChatOptions,
  type UpstreamMode,
} from './types';

/** Shape runtime của client zsdk 0.0.18 (verified dist/index.js + index.d.ts). */
interface ZaiClient {
  chat: {
    completions: {
      create: (body: Record<string, unknown>) => Promise<unknown>;
    };
  };
}

/**
 * zsdk 0.0.18 export shape:
 * - `export default ZAI` — default export là class ZAI (duy nhất, không named export).
 * - `ZAI.create()` (static async) → load config file (cwd → home → /etc/.z-ai-config) — dùng cho proxy mode.
 * - Constructor JS nhận `config {baseUrl, apiKey, chatId?, userId?, token?}`,
 *   NHƯNG index.d.ts khai báo `private constructor()` → real mode cast qua ZaiConstructor.
 */
type ZaiConstructor = new (config: {
  baseUrl: string;
  apiKey: string;
  chatId?: string;
  userId?: string;
  token?: string;
}) => ZaiClient;

const MAX_ERROR_MESSAGE = 500;

function upstreamMode(): UpstreamMode {
  return process.env.UPSTREAM === 'real' ? 'real' : 'proxy';
}

/**
 * Làm sạch message lỗi trước khi nhét vào SSE frame:
 * - redact giá trị ZAI_API_KEY nếu lỡ xuất hiện trong message upstream (không bao giờ log/relay key).
 * - bỏ \r/\n (SSE `data:` phải nằm trên 1 dòng — newline sẽ phá frame).
 * - cap độ dài.
 */
function sanitizeErrorMessage(message: string): string {
  let out = typeof message === 'string' && message.length > 0 ? message : 'unknown upstream error';
  const apiKey = process.env.ZAI_API_KEY;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/[\r\n]+/g, ' ');
  if (out.length > MAX_ERROR_MESSAGE) out = `${out.slice(0, MAX_ERROR_MESSAGE)}…`;
  return out;
}

async function createClient(mode: UpstreamMode): Promise<ZaiClient> {
  const mod = await import('z-ai-web-dev-sdk');
  const ZAI: unknown = mod.default;
  if (typeof ZAI !== 'function') {
    throw new Error('z-ai-web-dev-sdk: unexpected export shape — expected default ZAI class');
  }

  if (mode === 'proxy') {
    // Sandbox: config từ /etc/.z-ai-config (hoặc cwd/home) qua static ZAI.create().
    const factory = ZAI as unknown as { create: () => Promise<ZaiClient> };
    if (typeof factory.create !== 'function') {
      throw new Error('z-ai-web-dev-sdk: static ZAI.create() missing — proxy mode unusable');
    }
    return await factory.create();
  }

  // F8 real mode (VPS): dựng client với config inject trực tiếp.
  // Nếu key thiếu → lỗi trước-stream rõ ràng (nêu ZAI_API_KEY), KHÔNG bao giờ fallback về proxy.
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'UPSTREAM=real requires ZAI_API_KEY env (ZAI_BASE_URL optional, default https://api.z.ai/api/paas/v4)',
    );
  }
  const Constructible = ZAI as unknown as ZaiConstructor;
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  return new Constructible({ baseUrl, apiKey });
}

export function streamChat(
  req: ChatRequest,
  opts: StreamChatOptions = {},
): ReadableStream<Uint8Array> {
  const signal = opts.signal;

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let opened = false; // đã bắt đầu mở upstream (client + create)
  let closed = false; // stream của ta đã đóng
  let bytesEmitted = false; // phân biệt lỗi trước-stream vs giữa-stream
  let abortListener: (() => void) | null = null;

  const cleanup = (): void => {
    if (abortListener && signal) signal.removeEventListener('abort', abortListener);
    abortListener = null;
  };

  const closeQuietly = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controller?.close();
    } catch {
      // stream đã đóng từ trước — bỏ qua
    }
  };

  /** Lỗi TRƯỚC stream: đúng 1 frame lỗi rồi đóng sạch. */
  const emitErrorFrameAndClose = (message: string): void => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      controller?.enqueue(buildSseErrorFrame(sanitizeErrorMessage(message)));
    } catch {
      // controller đã đóng — bỏ qua
    }
    try {
      controller?.close();
    } catch {
      // bỏ qua
    }
  };

  const onAbort = (): void => {
    if (reader) {
      try {
        void reader.cancel();
      } catch {
        // bỏ qua
      }
    }
    closeQuietly(); // rule 4: abort → KHÔNG ghi thêm byte nào
  };

  const openUpstream = async (): Promise<void> => {
    if (opened || closed) return;
    opened = true;
    try {
      const mode = upstreamMode();
      const client = await createClient(mode);
      if (closed) return; // abort xảy ra trong lúc tạo client
      // F9: request model = pass-through tự do; response.model không bao giờ được dùng để quyết định.
      const body: unknown = await client.chat.completions.create({
        stream: true,
        model: req.model ?? DEFAULT_MODEL,
        messages: req.messages, // pass nguyên ChatMessage (kể cả reasoning_content khi preserved thinking)
        thinking: req.thinking ?? { type: 'enabled' },
        ...(req.max_tokens !== undefined ? { max_tokens: req.max_tokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });
      if (closed) return;
      if (!body || typeof (body as { getReader?: unknown }).getReader !== 'function') {
        // zsdk trả JSON object khi upstream không trả SSE cho stream:true → coi như lỗi trước-stream.
        emitErrorFrameAndClose('upstream returned a non-SSE response for a stream:true request');
        return;
      }
      reader = (body as ReadableStream<Uint8Array>).getReader();
    } catch (err) {
      // HTTP != 200 / zsdk throw / config thiếu → 1 frame lỗi rồi đóng sạch, KHÔNG throw ra caller.
      emitErrorFrameAndClose(err instanceof Error ? err.message : String(err));
    }
  };

  // Đảm bảo open chạy đúng 1 lần; MỌI pull await cùng promise này — chỉ resolve khi open HOÀN TẤT.
  // (Chống hang: pull KHÔNG được return sớm khi upstream chưa mở — verified hang trên Node 24/V8.)
  let openPromise: Promise<void> | null = null;
  const ensureOpen = (): Promise<void> => {
    if (!openPromise) openPromise = openUpstream();
    return openPromise;
  };

  return new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      if (signal) {
        if (signal.aborted) {
          // Đã abort trước cả khi mở upstream → stream rỗng đóng ngay, không gọi zsdk.
          closeQuietly();
          return;
        }
        abortListener = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      // start() không chờ upstream — pull() dưới đây await ensureOpen() trước khi đọc (consumer-driven).
      void ensureOpen();
    },
    async pull(c) {
      controller = c;
      if (closed) return;
      await ensureOpen();
      if (closed || !reader) return;
      try {
        const { done, value } = await reader.read();
        if (closed) return; // abort/cancel xảy ra trong lúc chờ read
        if (done) {
          closeQuietly();
          return;
        }
        bytesEmitted = true;
        c.enqueue(value); // RAW bytes nguyên xi — không chạm nội dung (F4). 1 pull = 1 chunk → backpressure tự nhiên.
      } catch (err) {
        if (signal?.aborted) {
          closeQuietly();
        } else if (!bytesEmitted) {
          // chưa phát byte nào → vẫn là "trước stream" từ góc nhìn user → frame lỗi sạch.
          emitErrorFrameAndClose(err instanceof Error ? err.message : String(err));
        } else {
          // lỗi GIỮA stream: chỉ đóng sạch — không chèn bytes giữa SSE frame dở dang (at-most-once).
          closeQuietly();
        }
      }
    },
    cancel() {
      closed = true;
      if (reader) {
        try {
          void reader.cancel();
        } catch {
          // bỏ qua
        }
      }
      cleanup();
    },
  });
}
