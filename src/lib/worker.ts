// src/lib/worker.ts — shared types + API helper cho Worker dashboard (:3000)
// UI gọi worker mini-service (Bun, port 3005) qua Caddy gateway bằng RELATIVE fetch +
// query XTransformPort (sandbox rule: KHÔNG ghi port trực tiếp vào URL).

export const WORKER_SERVICE_PORT = 3005;

export type WorkerPhase =
  | 'connecting'
  | 'registering'
  | 'online'
  | 'reconnecting'
  | 'stopped';

export interface WorkerStatus {
  ok: true;
  service: 'zaiwebhub-worker';
  version: string;
  configured: boolean;
  config_source: 'env' | 'file' | null;
  phase: WorkerPhase;
  registered: boolean;
  connected: boolean;
  inflight: number;
  total_jobs: number;
  uptime_sec: number;
  last_heartbeat: number | null;
  worker_id: string;
  hub_url: string;
  hub_ws_url: string;
  hub_token_url: string;
  attempt: number;
  last_error: string | null;
  upstream: string;
  mode: string;
  tenant_id: string;
  concurrency: number;
  models: string[];
  protocol_version: number;
  hostname: string;
  logs: string[];
}

export interface SetupPayload {
  hub_url: string;
  worker_id: string;
  worker_secret: string;
}

export interface SetupResult {
  ok: boolean;
  error?: string;
}

/** Fetch đến worker mini-service qua gateway — luôn RELATIVE path + XTransformPort query. */
export function workerFetch(path: string, init?: RequestInit): Promise<Response> {
  const joiner = path.includes('?') ? '&' : '?';
  return fetch(`${path}${joiner}XTransformPort=${WORKER_SERVICE_PORT}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export async function fetchWorkerStatus(): Promise<WorkerStatus> {
  const res = await workerFetch('/api/status');
  if (!res.ok) throw new Error(`worker service HTTP ${res.status}`);
  const data = (await res.json()) as WorkerStatus;
  return data;
}

export async function submitSetup(payload: SetupPayload): Promise<SetupResult> {
  const res = await workerFetch('/api/setup', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as SetupResult | null;
  if (!data) return { ok: false, error: `Phản hồi không hợp lệ (HTTP ${res.status})` };
  return data;
}

export async function submitDisconnect(): Promise<SetupResult> {
  const res = await workerFetch('/api/disconnect', { method: 'POST' });
  const data = (await res.json().catch(() => null)) as SetupResult | null;
  if (!data) return { ok: false, error: `Phản hồi không hợp lệ (HTTP ${res.status})` };
  return data;
}

export function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function relTime(ts: number | null): string {
  if (!ts) return '—';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 5_000) return 'vừa xong';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s trước`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m trước`;
  return `${Math.floor(diff / 3_600_000)}h trước`;
}
