// apps/worker — src/worker/config.ts
// Config từ env + default (spec: apps/worker/PLAN.md). Bun CHỈ là package manager — worker chạy Node (D1).
// NOTE: KHÔNG import node builtins ở module-level ('crypto'/'os'/'node:*') — Next dev còn compile
// module graph này cho edge runtime (instrumentation) và sẽ lỗi "Can't resolve". Dùng globalThis.crypto
// + env HOSTNAME: đủ cho worker_id fallback, edge-safe, và Node 20+ vẫn chạy đúng (D1 = Node runtime).
export interface WorkerConfig {
  hubUrl: string;
  hubHttpBase: string;
  tenantId: string;
  mode: 'worker' | 'relay';
  upstream: 'proxy' | 'real';
  workerId: string;
  concurrency: number;
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

export function loadConfig(): WorkerConfig {
  const concurrencyRaw = Number.parseInt(process.env.WORKER_CONCURRENCY ?? '2', 10);
  const concurrency = Number.isFinite(concurrencyRaw) && concurrencyRaw > 0 ? concurrencyRaw : 2;
  return {
    hubUrl: process.env.HUB_URL ?? 'ws://localhost:3003/worker',
    hubHttpBase: process.env.HUB_HTTP_BASE ?? 'http://localhost:3003',
    tenantId: process.env.TENANT_ID ?? 'default',
    mode: parseMode(process.env.MODE),
    upstream: parseUpstream(process.env.UPSTREAM),
    workerId: process.env.WORKER_ID ?? fallbackWorkerId(), // fallback: uuid-hostname
    concurrency,
    version: '0.1.0',
    heartbeatIntervalMs: 15_000,
  };
}
