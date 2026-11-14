// apps/webhub — runtime-api-keys.ts (4.2-K)
// Runtime API KEYS store — cho phép owner TẠO/THU HỒI Bearer key `zhb_*` NGAY TRÊN WEB
// (console :3000 → POST /api/api-keys → proxy sang hub /internal/api-keys) mà KHÔNG cần
// sửa env TENANT_KEYS + restart hub.
//
// Nguồn dữ liệu: file runtime <repo>/.runtime/api-keys.json — mode 0600, gitignored,
// CHỈ hub process ghi (console chỉ proxy) → không có race writer.
// Shape: { "keys": [ { id, name, prefix, hash, created_at, last_used_at, disabled } ], "updated_at" }
//   - hash   : SHA-256 hex của key NGUYÊN VĂN — file KHÔNG bao giờ chứa key plain
//              (key plain chỉ trả về client ĐÚNG 1 LẦN lúc tạo, mô hình như OpenAI).
//   - prefix : 12 ký tự đầu (vd `zhb_a1b2c3d4`) — đủ định danh trong UI, vô dụng khi gọi.
//
// Đọc file mỗi lần cần (cache TTL 2s) → key mới/thu hồi áp dụng NGAY cho /v1/*, không restart.
// last_used_at cập nhật in-memory + flush debounce 3s để không fs-write mỗi request stream.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { log } from './logger';

// src/runtime-api-keys.ts → src → hub → mini-services → repo root (cùng .runtime/ với worker-secret)
const ROOT = process.env.API_KEYS_FILE
  ? process.env.API_KEYS_FILE // deploy có thể override path đầy đủ
  : join(import.meta.dir, '..', '..', '..', '.runtime', 'api-keys.json');

const CACHE_TTL_MS = 2_000;
const MAX_KEYS = 50;
const FLUSH_DEBOUNCE_MS = 3_000;

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  hash: string;
  created_at: number;
  last_used_at: number | null;
  disabled: boolean;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  disabled: boolean;
}

let cache: { keys: ApiKeyRecord[]; at: number } | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function isRecordShape(v: unknown): v is ApiKeyRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.prefix === 'string' &&
    typeof r.hash === 'string' &&
    typeof r.created_at === 'number'
  );
}

async function readKeys(): Promise<ApiKeyRecord[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.keys;
  let keys: ApiKeyRecord[] = [];
  try {
    const raw = await readFile(ROOT, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { keys?: unknown }).keys)) {
      keys = ((parsed as { keys: unknown[] }).keys ?? []).filter(isRecordShape);
    }
  } catch {
    // ENOENT / JSON hỏng → coi như chưa có key runtime nào
  }
  cache = { keys, at: now };
  return keys;
}

async function writeKeys(keys: ApiKeyRecord[]): Promise<void> {
  await mkdir(dirname(ROOT), { recursive: true });
  const tmp = `${ROOT}.tmp-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify({ keys, updated_at: Date.now() }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, ROOT);
  cache = { keys, at: Date.now() };
  dirty = false;
}

/** Public shape — KHÔNG bao giờ trả hash ra ngoài (hash cho phép offline brute-force key yếu). */
export function toPublic(rec: ApiKeyRecord): ApiKeyPublic {
  return {
    id: rec.id,
    name: rec.name,
    prefix: rec.prefix,
    created_at: rec.created_at,
    last_used_at: rec.last_used_at,
    disabled: rec.disabled,
  };
}

/** Danh sách key runtime (không hash) — mới nhất lên đầu. */
export async function getRuntimeApiKeys(): Promise<ApiKeyPublic[]> {
  const keys = await readKeys();
  return [...keys].sort((a, b) => b.created_at - a.created_at).map(toPublic);
}

/**
 * Verify Bearer key CHẠY ĐỘNG: SHA-256(key) khớp 1 record còn hoạt động.
 * Key env (TENANT_KEYS) được check ở auth.ts — hàm này chỉ phụ trách key runtime.
 */
export async function isValidRuntimeApiKey(key: string): Promise<boolean> {
  const hash = hashApiKey(key);
  const keys = await readKeys();
  return keys.some((k) => !k.disabled && k.hash === hash);
}

/** Tạo key mới: `zhb_` + 32 ký tự base64url (192-bit entropy). Trả key NGUYÊN VĂN đúng 1 lần. */
export async function createRuntimeApiKey(rawName: string): Promise<{ key: string; record: ApiKeyPublic }> {
  const keys = await readKeys();
  if (keys.length >= MAX_KEYS) {
    throw new Error(`tối đa ${MAX_KEYS} key runtime — thu hồi bớt trước khi tạo`);
  }
  const name = rawName.trim().slice(0, 64) || `key-${new Date().toISOString().slice(0, 10)}`;
  const key = `zhb_${randomBytes(24).toString('base64url')}`;
  const record: ApiKeyRecord = {
    id: `ak_${randomBytes(6).toString('hex')}`,
    name,
    prefix: key.slice(0, 12),
    hash: hashApiKey(key),
    created_at: Date.now(),
    last_used_at: null,
    disabled: false,
  };
  await writeKeys([...keys, record]);
  log('info', 'runtime api key created', { key_id: record.id, prefix: record.prefix, total: keys.length + 1 });
  return { key, record: toPublic(record) };
}

/** Thu hồi (xoá hẳn) key theo id — client đang dùng key này sẽ 401 ngay lần gọi sau. */
export async function revokeRuntimeApiKey(id: string): Promise<boolean> {
  const keys = await readKeys();
  const next = keys.filter((k) => k.id !== id);
  if (next.length === keys.length) return false; // không tìm thấy
  await writeKeys(next);
  log('info', 'runtime api key revoked', { key_id: id, total: next.length });
  return true;
}

/**
 * Đánh dấu key vừa được dùng (last_used_at) — fire-and-forget, KHÔNG block request stream.
 * Flush debounce 3s: nhiều chunk request liên tục chỉ ghi file 1 lần / 3s.
 */
export function touchRuntimeApiKey(keyHash: string): void {
  void (async () => {
    try {
      const keys = await readKeys();
      const rec = keys.find((k) => k.hash === keyHash);
      if (!rec) return;
      rec.last_used_at = Date.now();
      cache = { keys, at: Date.now() };
      dirty = true;
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (!dirty) return;
        void writeKeys([...(cache?.keys ?? [])]).catch((err) =>
          log('warn', 'api-keys flush failed', { error: String(err) }),
        );
      }, FLUSH_DEBOUNCE_MS);
      flushTimer.unref?.();
    } catch {
      /* touch lỗi → bỏ qua, không ảnh hưởng request */
    }
  })();
}
