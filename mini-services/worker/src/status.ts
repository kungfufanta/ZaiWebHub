// mini-services/worker — src/status.ts
// Builder payload status dùng chung cho GET /api/status (dashboard :3000 poll endpoint này).
// KHÔNG bao giờ chứa worker_secret — secret không bao giờ rời server.
import { readFileConfig, resolveBootConfig, getHostname } from './file-config';
import { getRuntimeInfo } from './ws-client';
import { getLogRing } from './util';
import { PROTOCOL_VERSION } from './protocol';

export interface StatusPayload {
  ok: true;
  service: 'zaiwebhub-worker';
  version: string;
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

/** Tail log — dùng ring buffer 300 dòng (không phụ thuộc file log của process manager). */
export function tailLog(n = 100): string[] {
  return getLogRing().slice(-n);
}

export async function buildStatusPayload(): Promise<StatusPayload> {
  const boot = await resolveBootConfig();
  const file = boot?.source === 'file' ? await readFileConfig() : null;
  const rt = getRuntimeInfo();
  return {
    ok: true,
    service: 'zaiwebhub-worker',
    version: boot?.config.version ?? '0.1.0-mini',
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
    hub_ws_url: boot ? boot.config.hubUrl : '',
    hub_token_url: boot ? boot.config.hubTokenUrl : '',
    attempt: rt.attempt,
    last_error: rt.last_error,
    upstream: rt.upstream,
    mode: rt.mode,
    tenant_id: rt.tenant_id,
    concurrency: rt.concurrency,
    models: rt.models,
    protocol_version: PROTOCOL_VERSION,
    hostname: getHostname(),
    logs: tailLog(100),
  };
}
