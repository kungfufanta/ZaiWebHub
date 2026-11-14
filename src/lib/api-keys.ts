// apps/dev-console — lib/api-keys.ts (4.2-K)
// Types + helpers cho tab "API Keys": quản lý Bearer key `zhb_*` owner phát hành cho client
// BÊN NGOÀI gọi hub /v1/* (mô hình như OpenAI — key chỉ hiện NGUYÊN VĂN 1 lần lúc tạo).
// Client gọi /api/api-keys (proxy server-side tới hub :3003 /internal/api-keys, auth
// X-Worker-Secret giữ ở server — KHÔNG bao giờ xuống client).
// KHÔNG chứa secret/key — list trả về chỉ có prefix mask (vd `zhb_ab12…`).
'use client';

export interface ApiKeyRow {
  id: string;
  name: string;
  /** Prefix mask vd `zhb_ab12cd34…` — đủ định danh, không dùng được để gọi. */
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  disabled: boolean;
}

export interface ApiKeysSnapshot {
  keys: ApiKeyRow[];
  /** Số key legacy trong env TENANT_KEYS (hub boot) — chỉ đếm + preview mask, không sửa được. */
  env_key_count: number;
  env_keys_preview: string[];
}

export interface CreateKeyResult {
  ok: boolean;
  /** Key NGUYÊN VĂN — chỉ trả về ĐÚNG 1 lần lúc tạo, không bao giờ thấy lại. */
  key?: string;
  record?: ApiKeyRow;
  error?: string;
}

export interface RevokeKeyResult {
  ok: boolean;
  removed_id?: string;
  error?: string;
}

export interface ApiKeysResult {
  ok: boolean;
  status: number;
  data?: ApiKeysSnapshot;
  error?: string;
}

function extractErrMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const rec = body as Record<string, unknown>;
    const err = rec.error;
    if (typeof err === 'object' && err !== null) {
      const msg = (err as Record<string, unknown>).message;
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    if (typeof err === 'string' && err.length > 0) return err;
    if (typeof rec.message === 'string' && rec.message.length > 0) return rec.message;
  }
  return fallback;
}

export async function fetchApiKeys(signal?: AbortSignal): Promise<ApiKeysResult> {
  try {
    const res = await fetch('/api/api-keys', { cache: 'no-store', signal });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return { ok: false, status: res.status, error: extractErrMessage(body, `HTTP ${res.status}`) };
    }
    const snap = body as ApiKeysSnapshot;
    if (!snap || !Array.isArray(snap.keys)) {
      return { ok: false, status: res.status, error: 'response shape không đúng (thiếu keys[])' };
    }
    return { ok: true, status: res.status, data: snap };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

export async function createApiKey(name: string): Promise<CreateKeyResult> {
  try {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return { ok: false, error: extractErrMessage(body, `HTTP ${res.status}`) };
    }
    const rec = body as { key?: string; record?: ApiKeyRow };
    if (typeof rec.key !== 'string' || rec.key.length === 0 || !rec.record) {
      return { ok: false, error: 'response thiếu key/record' };
    }
    return { ok: true, key: rec.key, record: rec.record };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function revokeApiKey(id: string): Promise<RevokeKeyResult> {
  try {
    const res = await fetch(`/api/api-keys?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) {
      return { ok: false, error: extractErrMessage(body, `HTTP ${res.status}`) };
    }
    return { ok: true, removed_id: (body as { removed_id?: string }).removed_id ?? id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Mask hiển thị an toàn cho env keys: chỉ giữ 8 ký tự đầu + … */
export function maskEnvKey(key: string): string {
  return `${key.slice(0, 12)}…`;
}
