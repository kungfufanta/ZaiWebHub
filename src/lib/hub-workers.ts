// apps/dev-console — lib/hub-workers.ts (3.6-H)
// Types + helpers dùng chung cho tab /workers và /stats: poll /api/workers (server-side proxy
// giữ secret), format relative time + uptime. KHÔNG chứa secret.
'use client';

export interface WorkerCapabilities {
  worker_id: string;
  tenant_id: string;
  models: string[];
  concurrency: number;
  protocol_version: number;
}

export interface WorkerRow {
  id: string;
  status: 'online' | 'offline';
  connected_at: number;
  last_heartbeat: number;
  inflight: number;
  total_jobs: number;
  capabilities: WorkerCapabilities;
}

export interface WorkersSnapshot {
  workers: WorkerRow[];
  uptime_seconds: number;
  total_jobs_all_time: number;
}

export interface WorkersResult {
  ok: boolean;
  status: number;
  data?: WorkersSnapshot;
  error?: string;
}

export async function fetchWorkersSnapshot(signal?: AbortSignal): Promise<WorkersResult> {
  try {
    const res = await fetch('/api/workers', { cache: 'no-store', signal });
    const body = (await res.json().catch(() => null)) as
      | (WorkersSnapshot & { error?: { message?: string } })
      | { error?: { message?: string } }
      | null;
    if (!res.ok) {
      const msg =
        (body as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, error: msg };
    }
    const snap = body as WorkersSnapshot;
    if (!snap || !Array.isArray(snap.workers)) {
      return { ok: false, status: res.status, error: 'response shape không đúng (thiếu workers[])' };
    }
    return { ok: true, status: res.status, data: snap };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

// "vừa xong" / "12s trước" / "3p trước" / "2h trước"
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (diff < 5) return 'vừa xong';
  if (diff < 60) return `${diff}s trước`;
  if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
  return `${Math.floor(diff / 86400)}d trước`;
}

export function formatUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

// HUB_PUBLIC_BASE → URL worker paste vào form setup của nó (đúng spec 3.6-H)
export function buildWorkerTokenUrl(hubPublicBase: string): string {
  const base = hubPublicBase.trim().replace(/\/+$/, '');
  return `${base}/internal/worker-token?XTransformPort=3003`;
}
