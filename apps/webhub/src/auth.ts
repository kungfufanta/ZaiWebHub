// apps/webhub — auth.ts (T3-e + T3-f)
// User auth: Bearer key khớp env TENANT_KEYS cho /v1/* (dev: mọi key map về tenant 'default').
// Worker auth: hub mint HMAC short-lived token (~60s TTL) cho /internal/worker-token;
// worker đưa token vào worker.register, hub verify (signature + exp + tenant).
// LƯU Ý BẢO MẬT (dev-only): /internal hiện KHÔNG xác thực — production hardening TODO
// (phải gate route này bằng network policy / admin auth trước khi lên VPS).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { log } from './logger.js';

const DEFAULT_TENANT_KEY = 'zhb_dev_default_key';
const DEFAULT_SECRET = 'dev-secret-rotate-me';
export const DEFAULT_WORKER_TOKEN_TTL_SECONDS = 60;

export interface WorkerTokenPayload {
  tenant_id: string;
  iat: number;
  exp: number; // epoch ms
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function getSecret(): string {
  const s = process.env.WEBHUB_SECRET;
  if (!s) return DEFAULT_SECRET;
  return s;
}

export function getTenantKeys(): string[] {
  return (process.env.TENANT_KEYS ?? DEFAULT_TENANT_KEY)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidApiKey(key: string): boolean {
  return getTenantKeys().includes(key);
}

// D3 dev mapping: MVP single tenant — mọi key hợp lệ map về tenant 'default'.
// Prod: mỗi key sẽ map về tenant riêng (open question cho owner, không thuộc scope MVP).
export function tenantForApiKey(): string {
  return 'default';
}

export function bearerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? m[1].trim() : null;
}

// ---------- Worker token (T3-f) ----------
export function mintWorkerToken(
  tenantId: string,
  ttlSeconds: number = DEFAULT_WORKER_TOKEN_TTL_SECONDS,
): { token: string; exp: number } {
  const now = Date.now();
  const exp = now + ttlSeconds * 1000;
  const payload = b64url(Buffer.from(JSON.stringify({ tenant_id: tenantId, iat: now, exp })));
  const sig = b64url(createHmac('sha256', getSecret()).update(payload).digest());
  return { token: `${payload}.${sig}`, exp };
}

export function verifyWorkerToken(
  token: string,
): { ok: true; payload: WorkerTokenPayload } | { ok: false; reason: string } {
  const dot = token.indexOf('.');
  if (dot <= 0) return { ok: false, reason: 'malformed token' };
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', getSecret()).update(payload).digest();
  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, 'base64url');
  } catch {
    return { ok: false, reason: 'bad signature encoding' };
  }
  if (sigBuf.length !== expected.length || !timingSafeEqual(sigBuf, expected)) {
    return { ok: false, reason: 'signature mismatch' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad payload encoding' };
  }
  const p = parsed as Partial<WorkerTokenPayload>;
  if (typeof p.tenant_id !== 'string' || p.tenant_id.length === 0) {
    return { ok: false, reason: 'payload missing tenant_id' };
  }
  if (typeof p.exp !== 'number' || typeof p.iat !== 'number') {
    return { ok: false, reason: 'payload missing exp/iat' };
  }
  if (p.exp < Date.now()) return { ok: false, reason: 'token expired' };
  return { ok: true, payload: { tenant_id: p.tenant_id, iat: p.iat, exp: p.exp } };
}

// Ghi log cảnh báo một lần lúc boot (T3-f) — không in secret ra log.
export function logSecurityBaselineWarnings(): void {
  if (!process.env.WEBHUB_SECRET) {
    log('warn', 'WEBHUB_SECRET not set — using default dev secret; rotate before any real deployment');
  }
  log('warn', '/internal/worker-token is UNAUTHENTICATED in dev — production hardening TODO (T3-f)');
}
