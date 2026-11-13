// apps/worker — src/worker/status.ts (Task 3.6-W)
// Builder payload status dùng chung: GET /api/status + server component page.tsx.
// NODE-ONLY (đọc file worker.log) — KHÔNG import từ module nào có thể bị compile cho edge.
import { readFileConfig } from './file-config';
import { getRuntimeInfo } from './ws-client';
import { getLogRing } from './util';

export interface StatusPayload {
  configured: boolean;
  config_source: 'env' | 'file' | null;
  phase: string;
  registered: boolean;
  connected: boolean;
  inflight: number;
  total_jobs: number;
  uptime_sec: number;
  last_heartbeat: number | null;
  worker_id: string;
  hub_url: string;
  attempt: number;
  last_error: string | null;
  upstream: string;
  mode: string;
  logs: string[];
}

/** Tail worker.log (stdout của process) — nếu không đọc được thì dùng ring buffer. */
export async function tailWorkerLog(n = 100): Promise<string[]> {
  try {
    const fs = await import('node:fs');
    const raw = await fs.promises.readFile(`${process.cwd()}/worker.log`, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-n);
  } catch {
    return getLogRing().slice(-n);
  }
}

export async function buildStatusPayload(): Promise<StatusPayload> {
  const { resolveBootConfig } = await import('./file-config');
  const boot = await resolveBootConfig();
  const file = boot?.source === 'file' ? await readFileConfig() : null;
  const rt = getRuntimeInfo();
  return {
    configured: boot !== null,
    config_source: boot?.source ?? null,
    phase: rt.phase,
    registered: rt.registered,
    connected: rt.connected,
    inflight: rt.inflight,
    total_jobs: rt.total_jobs,
    uptime_sec: rt.uptime_s,
    last_heartbeat: rt.last_heartbeat,
    worker_id: boot ? boot.config.workerId : '',
    hub_url: file?.hub_url ?? (boot ? boot.config.hubHttpBase : ''),
    attempt: rt.attempt,
    last_error: rt.last_error,
    upstream: rt.upstream,
    mode: rt.mode,
    logs: await tailWorkerLog(100),
  };
}
