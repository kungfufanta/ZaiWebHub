// apps/dev-console — lib/worker-secret-store.ts (4.0-W)
// Lưu trữ WORKER_SECRET CHẠY ĐỘNG — cho phép owner TẠO/XOAY secret NGAY TRÊN WEB
// (tab /workers → box Worker Connection Info) KHÔNG cần sửa .env.local + restart.
//
// Nguồn sự thật (priority khi resolve):
//   1. File runtime  : <repo>/.runtime/worker-secret.json  (ghi bởi POST /api/worker-secret)
//                      { "worker_secret": "...", "updated_at": <epoch ms> } — mode 0600, gitignored.
//   2. process.env.WORKER_SECRET (boot env — cách deploy kiểu cũ, vẫn hợp lệ khi file chưa có).
//
// Vì sao file runtime: console (:3000), hub (:3003) và worker local (:3005) cùng 1 sandbox/1 repo
// → cả 3 đọc cùng file MỖI LẦN CẦN (fs read nhỏ, cache TTL 2s) → secret mới áp dụng NGAY,
// không restart service nào. .env.local vẫn được ghi đồng bộ để restart/ redeploy giữ nguyên giá trị.
//
// Bảo mật: file 0600; route KHÔNG BAO GIỜ log secret; secret không bao giờ trả về client
// trừ khi owner bấm reveal (client tự mask).
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type WorkerSecretSource = 'runtime-file' | 'env';

export interface WorkerSecretInfo {
  secret: string | null;
  source: WorkerSecretSource | null;
}

const RUNTIME_DIR = join(process.cwd(), '.runtime');
const RUNTIME_FILE = process.env.WORKER_SECRET_FILE
  ? /* deploy có thể override path */ process.env.WORKER_SECRET_FILE
  : join(RUNTIME_DIR, 'worker-secret.json');
const ENV_LOCAL_FILE = join(process.cwd(), '.env.local');
const LOCAL_WORKER_CONFIG = join(process.cwd(), 'mini-services', 'worker', 'worker-config.json');

// Cache ngắn chống fs-lặp: /internal/workers poll 5s + token mint lẻ tẻ → đủ rẻ mà vẫn "live".
const CACHE_TTL_MS = 2_000;
let cache: { info: WorkerSecretInfo; at: number } | null = null;

function isValidSecretShape(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 256;
}

async function readRuntimeFileSecret(): Promise<string | null> {
  try {
    const raw = await readFile(RUNTIME_FILE, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    return isValidSecretShape(rec.worker_secret) ? rec.worker_secret : null;
  } catch {
    return null; // ENOENT / JSON hỏng → coi như chưa có file
  }
}

/** Resolve secret hiện tại: runtime file ưu tiên, env fallback. Có cache TTL 2s. */
export async function getWorkerSecretInfo(): Promise<WorkerSecretInfo> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.info;
  const fileSecret = await readRuntimeFileSecret();
  const info: WorkerSecretInfo = fileSecret
    ? { secret: fileSecret, source: 'runtime-file' }
    : isValidSecretShape(process.env.WORKER_SECRET)
      ? { secret: process.env.WORKER_SECRET, source: 'env' }
      : { secret: null, source: null };
  cache = { info, at: now };
  return info;
}

/** Sinh secret ngẫu nhiên 256-bit (64 ký tự hex) — chuẩn openssl rand -hex 32. */
export function generateWorkerSecret(): string {
  return randomBytes(32).toString('hex');
}

/** Validate giá trị tự nhập: 16–128 ký tự, không whitespace/ký tự điều khiển. Trả error message hoặc null. */
export function validateCustomSecret(v: string): string | null {
  if (v.length < 16) return 'Quá ngắn — tối thiểu 16 ký tự.';
  if (v.length > 128) return 'Qua dài — tối đa 128 ký tự.';
  if (!/^[A-Za-z0-9._~@#$%^&*+=:-]+$/.test(v)) {
    return 'Chỉ cho phép chữ, số và ký tự . _ ~ @ # $ % ^ & * + = : - (không khoảng trắng).';
  }
  return null;
}

/** Ghi runtime file (atomic: tmp + rename, mode 0600). */
export async function writeRuntimeSecretFile(secret: string): Promise<void> {
  await mkdir(RUNTIME_DIR, { recursive: true });
  const tmp = `${RUNTIME_FILE}.tmp-${Date.now()}`;
  await writeFile(
    tmp,
    `${JSON.stringify({ worker_secret: secret, updated_at: Date.now() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(tmp, RUNTIME_FILE);
  cache = null; // invalidate — lần resolve sau đọc lại file
}

/**
 * Đồng bộ `.env.local` (console) — replace dòng WORKER_SECRET= hiện có hoặc append cuối file.
 * Mục đích: restart/redeploy console giữ nguyên giá trị (file runtime vẫn là nguồn ưu tiên).
 */
async function syncEnvLocal(secret: string): Promise<boolean> {
  const line = `WORKER_SECRET=${secret}`;
  let raw = '';
  try {
    raw = await readFile(ENV_LOCAL_FILE, 'utf8');
  } catch {
    // chưa có .env.local → tạo mới
  }
  const lines = raw.length > 0 ? raw.split('\n') : [];
  const idx = lines.findIndex((l) => /^WORKER_SECRET=/.test(l));
  if (idx >= 0) {
    if (lines[idx] === line) return false;
    lines[idx] = line;
  } else {
    if (raw.length > 0 && !raw.endsWith('\n')) lines.push('');
    lines.push('# WORKER_SECRET — tạo từ web UI (tab /workers); file runtime .runtime/worker-secret.json là nguồn ưu tiên');
    lines.push(line);
  }
  const tmp = `${ENV_LOCAL_FILE}.tmp-${Date.now()}`;
  await writeFile(tmp, `${lines.join('\n')}\n`, { mode: 0o600 });
  await rename(tmp, ENV_LOCAL_FILE);
  return true;
}

/**
 * Đồng bộ worker-config.json của worker LOCAL (mini-services/worker) nếu nó tồn tại —
 * giữ hub_url + worker_id, chỉ thay worker_secret để worker local không 401 sau khi xoay.
 * Worker không tồn tại config (chưa setup) → bỏ qua (trả false).
 */
async function syncLocalWorkerConfig(secret: string): Promise<boolean> {
  try {
    const raw = await readFile(LOCAL_WORKER_CONFIG, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return false;
    const cfg = parsed as Record<string, unknown>;
    if (typeof cfg.hub_url !== 'string' || typeof cfg.worker_id !== 'string') return false;
    if (cfg.worker_secret === secret) return false;
    cfg.worker_secret = secret;
    const tmp = `${LOCAL_WORKER_CONFIG}.tmp-${Date.now()}`;
    await writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, LOCAL_WORKER_CONFIG);
    return true;
  } catch {
    return false; // chưa có config → worker local chưa setup, không cần sync
  }
}

/** Hash SHA-256 để log định danh giá trị mà KHÔNG lộ secret (8 ký tự đầu hex). */
export function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 8);
}

export interface SaveSecretResult {
  secret: string;
  fingerprint: string;
  env_local_updated: boolean;
  worker_config_updated: boolean;
}

/** Tạo/xoay secret: ghi runtime file + sync .env.local + sync worker local config. */
export async function saveWorkerSecret(secret: string): Promise<SaveSecretResult> {
  await writeRuntimeSecretFile(secret);
  const envLocal = await syncEnvLocal(secret).catch(() => false);
  const workerCfg = await syncLocalWorkerConfig(secret).catch(() => false);
  return {
    secret,
    fingerprint: fingerprint(secret),
    env_local_updated: envLocal,
    worker_config_updated: workerCfg,
  };
}

/** Kiểm tra file runtime tồn tại (để UI phân biệt "chưa set" vs "đã set qua web"). */
export async function runtimeFileExists(): Promise<boolean> {
  try {
    const s = await stat(RUNTIME_FILE);
    return s.isFile();
  } catch {
    return false;
  }
}
