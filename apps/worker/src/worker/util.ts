// apps/worker — src/worker/util.ts
// Helpers chung: log (BẮT BUỘC job_id/request_id trong ctx khi có), sleep, sanitize message lỗi.
// SECURITY (T3-f baseline): KHÔNG bao giờ log API key / token / reasoning_content / nội dung message.

export type LogLevel = 'info' | 'warn' | 'error';

// Task 3.6-W — in-memory ring buffer cho log tail trên status UI (fallback khi không đọc được worker.log).
// Edge-safe: chỉ dùng globalThis, không node builtins.
const LOG_RING_MAX = 300;
type LogRingGlobal = typeof globalThis & { __zaiwebhubLogRing?: string[] };

export function getLogRing(): string[] {
  return (globalThis as LogRingGlobal).__zaiwebhubLogRing ?? [];
}

export function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const parts = ['[worker]', `[${level}]`, msg];
  if (ctx && Object.keys(ctx).length > 0) {
    try {
      parts.push(JSON.stringify(ctx));
    } catch {
      parts.push('(ctx unserializable)');
    }
  }
  const line = parts.join(' ');
  console.log(line);
  const g = globalThis as LogRingGlobal;
  if (!g.__zaiwebhubLogRing) g.__zaiwebhubLogRing = [];
  g.__zaiwebhubLogRing.push(`${new Date().toISOString()} ${line}`);
  if (g.__zaiwebhubLogRing.length > LOG_RING_MAX) {
    g.__zaiwebhubLogRing.splice(0, g.__zaiwebhubLogRing.length - LOG_RING_MAX);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Message lỗi an toàn để log/đưa vào frame: redact key, bỏ newline, cap độ dài. */
export function sanitizeErrorMessage(message: unknown, max = 300): string {
  let out = typeof message === 'string' && message.length > 0 ? message : 'unknown error';
  const apiKey = process.env.ZAI_API_KEY;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('[redacted]');
  out = out.replace(/[\r\n]+/g, ' ');
  if (out.length > max) out = `${out.slice(0, max)}…`;
  return out;
}

export function errMsg(err: unknown, max = 300): string {
  return sanitizeErrorMessage(err instanceof Error ? err.message : String(err), max);
}
