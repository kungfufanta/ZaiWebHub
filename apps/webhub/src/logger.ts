// apps/webhub — structured logger with redaction (T3-f security baseline).
// QUY TẮC: mọi dòng log PHẢI có request_id và/hoặc job_id khi có ngữ cảnh job.
// TUYỆT ĐỐI không log reasoning_content / API key / token nguyên văn — sanitize ở đây.
const REDACTED_KEYS = new Set([
  'authorization',
  'token',
  'api_key',
  'apikey',
  'x-api-key',
  'messages',
  'content',
  'reasoning_content',
  'reasoning_blocks',
]);

function sanitize(fields?: Record<string, unknown>): Record<string, unknown> {
  if (!fields) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = '[REDACTED]';
      continue;
    }
    out[k] = v;
  }
  return out;
}

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    service: 'webhub',
    msg,
    ...sanitize(fields),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
