// apps/worker — src/worker/util.ts
// Helpers chung: log (BẮT BUỘC job_id/request_id trong ctx khi có), sleep, sanitize message lỗi.
// SECURITY (T3-f baseline): KHÔNG bao giờ log API key / token / reasoning_content / nội dung message.

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
  const parts = ['[worker]', `[${level}]`, msg];
  if (ctx && Object.keys(ctx).length > 0) {
    try {
      parts.push(JSON.stringify(ctx));
    } catch {
      parts.push('(ctx unserializable)');
    }
  }
  console.log(parts.join(' '));
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
