// apps/worker — src/worker/file-config.ts (Task 3.6-W)
// Config persistence trên FILE (ưu tiên thấp hơn env) + derive URL hub cho gateway công cộng.
// File: apps/worker/.worker-config.json (gitignored — KHÔNG BAO GIỜ commit, có WORKER_SECRET).
// Format: { "hub_url": "https://...", "worker_id": "...", "worker_secret": "..." }
//
// EDGE-SAFETY: module này có thể lọt vào module graph của instrumentation (Next dev compile thêm
// nhánh edge) → KHÔNG import node builtins ở module-level; mọi truy cập fs/os đều lazy
// `await import('node:fs')` bên trong hàm + webpack fallback (xem next.config.ts).
// Các caller thực tế đều chạy Node runtime (instrumentation register, route `runtime='nodejs'`).
import type { WorkerConfig } from './config';

export interface FileConfig {
  /** Hub public base URL — http/https (hoặc wss nếu copy thẳng WS URL). Có thể kèm ?XTransformPort=... */
  hub_url: string;
  worker_id: string;
  worker_secret: string;
}

/** Kết quả parse hub_url → 3 URL runtime mà ws-client cần. */
export interface HubUrls {
  /** WS URL đầy đủ cho ws client (wss://host/worker?query) */
  hubUrl: string;
  /** HTTP origin (không query) — fallback base */
  hubHttpBase: string;
  /** Token endpoint đầy đủ, giữ nguyên query gateway (https://host/internal/worker-token?query) */
  hubTokenUrl: string;
}

const WORKER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidWorkerId(raw: unknown): raw is string {
  return typeof raw === 'string' && WORKER_ID_RE.test(raw.trim());
}

/**
 * Parse hub URL đa dạng người dùng có thể paste:
 *  - https://preview-xxx.space-z.ai                       (base trần — chỉ hợp lệ khi hub ở :443 mặc định)
 *  - https://preview-xxx.space-z.ai/?XTransformPort=3003  (base + query gateway — dạng khuyến nghị)
 *  - wss://preview-xxx.space-z.ai/worker?XTransformPort=3003 (copy thẳng WS URL)
 * Query string được GIỮ NGUYÊN trên mọi URL derive (gateway sandbox cần ?XTransformPort=3003).
 */
export function parseHubUrl(raw: string): HubUrls | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.length > 2048) return null;
  let u: URL;
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      u = new URL(trimmed);
    } else {
      // Không có scheme: phải trông giống hostname thật (có dấu chấm) — chặn rác kiểu "not-a-url".
      const candidate = trimmed.split('/')[0].split('?')[0];
      if (!candidate.includes('.')) return null;
      u = new URL(`https://${trimmed}`);
    }
  } catch {
    return null;
  }
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(u.protocol)) return null;
  if (!u.hostname) return null;
  const query = u.search; // '' hoặc '?XTransformPort=3003'
  const isWsScheme = u.protocol === 'wss:' || u.protocol === 'ws:';
  const httpProto = u.protocol === 'http:' || u.protocol === 'ws:' ? 'http:' : 'https:';
  const wsProto = httpProto === 'https:' ? 'wss:' : 'ws:';
  const pathIsWorker = /^\/worker\/?$/.test(u.pathname);
  if (isWsScheme && !pathIsWorker) return null; // WS URL phải trỏ đúng /worker
  const origin = `${httpProto}//${u.host}`;
  return {
    hubUrl: isWsScheme
      ? `${wsProto}//${u.host}${u.pathname}${query}`
      : `${wsProto}//${u.host}/worker${query}`,
    hubHttpBase: origin,
    hubTokenUrl: `${origin}/internal/worker-token${query}`,
  };
}

function isValidFileConfig(x: unknown): x is FileConfig {
  if (typeof x !== 'object' || x === null) return false;
  const c = x as Record<string, unknown>;
  return (
    typeof c.hub_url === 'string' &&
    parseHubUrl(c.hub_url) !== null &&
    isValidWorkerId(c.worker_id) &&
    typeof c.worker_secret === 'string' &&
    c.worker_secret.length > 0 &&
    c.worker_secret.length <= 256
  );
}

function configFilePath(): string {
  // cwd của next dev = apps/worker → file nằm cạnh package.json (gitignored).
  return `${process.cwd()}/.worker-config.json`;
}

/** Đọc config file. Trả null nếu thiếu / hỏng format (không throw). */
export async function readFileConfig(): Promise<FileConfig | null> {
  try {
    const fs = await import('node:fs');
    const raw = await fs.promises.readFile(configFilePath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isValidFileConfig(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Ghi config file (atomic: tmp + rename). */
export async function writeFileConfig(cfg: FileConfig): Promise<void> {
  const fs = await import('node:fs');
  const target = configFilePath();
  const tmp = `${target}.tmp-${Date.now()}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tmp, target);
}

/** Xoá config file (disconnect). Không throw nếu thiếu. */
export async function deleteFileConfig(): Promise<void> {
  try {
    const fs = await import('node:fs');
    await fs.promises.unlink(configFilePath());
  } catch {
    // ENOENT — chấp nhận
  }
}

/** Hostname sandbox cho pre-fill Worker ID trong setup form. */
export async function getHostname(): Promise<string> {
  try {
    const os = await import('node:os');
    const h = os.hostname?.() ?? '';
    if (h) return h;
  } catch {
    // rơi xuống env
  }
  return process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown-host';
}

export interface ResolvedBoot {
  source: 'env' | 'file';
  config: WorkerConfig;
}

/**
 * Boot config resolution — ĐỘ ƯU TIÊN:
 *  1. ENV (HUB_URL + WORKER_ID + WORKER_SECRET đủ cả 3) → headless mode, env thắng.
 *     HUB_TOKEN_URL env (nếu có) vẫn được tôn trọng; thiếu → derive từ HUB_URL.
 *  2. FILE .worker-config.json → mode UI (setup qua :3000).
 *  3. null → chưa cấu hình → serve SETUP UI, KHÔNG start WS.
 */
export async function resolveBootConfig(): Promise<ResolvedBoot | null> {
  const { loadConfig } = await import('./config');
  const envHub = process.env.HUB_URL;
  const envId = process.env.WORKER_ID;
  const envSecret = process.env.WORKER_SECRET;
  if (envHub && envHub.length > 0 && envId && envId.length > 0 && envSecret && envSecret.length > 0) {
    const cfg = loadConfig(); // env-based defaults
    const urls = parseHubUrl(envHub);
    if (urls) {
      cfg.hubUrl = urls.hubUrl;
      cfg.hubHttpBase = urls.hubHttpBase;
      if (!cfg.hubTokenUrl) cfg.hubTokenUrl = urls.hubTokenUrl;
    }
    return { source: 'env', config: cfg };
  }
  const file = await readFileConfig();
  if (file) return { source: 'file', config: await fileConfigToWorkerConfig(file) };
  return null;
}

/** Map FileConfig → WorkerConfig nội bộ của ws-client (upstream=proxy mặc định sandbox). */
export async function fileConfigToWorkerConfig(file: FileConfig): Promise<WorkerConfig> {
  const urls = parseHubUrl(file.hub_url);
  if (!urls) throw new Error('invalid hub_url in worker config file');
  const { loadConfig } = await import('./config');
  const base = loadConfig(); // lấy defaults tenant/mode/upstream/concurrency/heartbeat
  return {
    ...base,
    hubUrl: urls.hubUrl,
    hubHttpBase: urls.hubHttpBase,
    hubTokenUrl: urls.hubTokenUrl,
    workerId: file.worker_id.trim(),
    workerSecret: file.worker_secret,
  };
}
