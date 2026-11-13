// mini-services/worker — src/config.ts
// Port từ ZaiWebHub apps/worker/src/worker/config.ts.
// Config từ env + default. Chạy trong Bun mini-service (không còn ràng buộc edge-safety của Next dev,
// nhưng giữ nguyên shape để khớp hành vi với bản gốc).
export interface WorkerConfig {
  hubUrl: string;
  hubHttpBase: string;
  /** Đầy đủ URL token endpoint. '' → derive từ hubHttpBase. Dùng khi qua gateway công cộng:
   *  HUB_TOKEN_URL=https://<hub-host>/internal/worker-token?XTransformPort=3003 */
  hubTokenUrl: string;
  /** Shared secret gate /internal/worker-token. '' → không gửi header (dev loopback). */
  workerSecret: string;
  tenantId: string;
  mode: 'worker' | 'relay';
  upstream: 'proxy' | 'real';
  workerId: string;
  concurrency: number;
  models: string[];
  version: string;
  heartbeatIntervalMs: number;
}

function parseMode(raw: string | undefined): 'worker' | 'relay' {
  return raw === 'relay' ? 'relay' : 'worker';
}

function parseUpstream(raw: string | undefined): 'proxy' | 'real' {
  return raw === 'real' ? 'real' : 'proxy'; // F8: proxy là mặc định (sandbox)
}

function fallbackWorkerId(): string {
  const uuid =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const host = process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown-host';
  return `${uuid}-${host}`;
}

function parseModels(raw: string | undefined): string[] {
  const models = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return models.length > 0 ? models : ['glm-5.3'];
}

export function loadConfig(): WorkerConfig {
  const concurrencyRaw = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;
  return {
    hubUrl: process.env.HUB_URL ?? 'ws://localhost:3003/worker',
    hubHttpBase: process.env.HUB_HTTP_BASE ?? 'http://localhost:3003',
    hubTokenUrl: process.env.HUB_TOKEN_URL ?? '',
    workerSecret: process.env.WORKER_SECRET ?? '',
    tenantId: process.env.TENANT_ID ?? 'default',
    mode: parseMode(process.env.MODE),
    upstream: parseUpstream(process.env.UPSTREAM),
    workerId: process.env.WORKER_ID ?? fallbackWorkerId(), // fallback: uuid-hostname
    concurrency,
    models: parseModels(process.env.WORKER_MODELS),
    version: '0.1.0-mini',
    heartbeatIntervalMs: 15_000,
  };
}
