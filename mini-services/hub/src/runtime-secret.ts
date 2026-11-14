// apps/webhub — runtime-secret.ts (4.0-W)
// Resolve WORKER_SECRET CHẠY ĐỘNG: owner tạo/xoay secret trên web UI (console :3000 →
// POST /api/worker-secret) ghi vào file runtime .runtime/worker-secret.json của repo.
// Hub đọc lại file MỖI LẦN CẦN (cache TTL 2s) → gate áp dụng secret mới NGAY, không restart.
//
// Priority: runtime file (nếu có + hợp lệ) > process.env.WORKER_SECRET > null (dev mode).
// File cùng sandbox với console (1 repo) → cả 2 service luôn thấy cùng giá trị.
// KHÔNG BAO GIỜ log giá trị secret.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// src/runtime-secret.ts → src → hub → mini-services → repo root
const ROOT = process.env.WORKER_SECRET_FILE
  ? process.env.WORKER_SECRET_FILE // deploy có thể override path đầy đủ
  : join(import.meta.dir, '..', '..', '..', '.runtime', 'worker-secret.json');

const CACHE_TTL_MS = 2_000;
let cache: { secret: string | null; at: number } | null = null;

function isValidSecretShape(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 8 && v.length <= 256;
}

async function readRuntimeFileSecret(): Promise<string | null> {
  try {
    const raw = await readFile(ROOT, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const rec = parsed as Record<string, unknown>;
    return isValidSecretShape(rec.worker_secret) ? rec.worker_secret : null;
  } catch {
    return null; // ENOENT / JSON hỏng → coi như chưa có file
  }
}

export interface ResolvedWorkerSecret {
  secret: string | null;
  source: 'runtime-file' | 'env';
}

/** Resolve secret hiện tại — file runtime ưu tiên, env fallback. Cache TTL 2s. */
export async function resolveWorkerSecret(): Promise<ResolvedWorkerSecret> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS && cache.secret !== null) {
    // cache chỉ giữ secret NON-NULL; secret vừa bị xoá khỏi file → TTL hết sẽ re-resolve
    return { secret: cache.secret, source: 'runtime-file' };
  }
  const fileSecret = await readRuntimeFileSecret();
  if (fileSecret) {
    cache = { secret: fileSecret, at: now };
    return { secret: fileSecret, source: 'runtime-file' };
  }
  const envSecret = process.env.WORKER_SECRET;
  if (isValidSecretShape(envSecret)) {
    cache = { secret: envSecret, at: now };
    return { secret: envSecret, source: 'env' };
  }
  cache = { secret: null, at: now };
  return { secret: null, source: 'env' };
}
