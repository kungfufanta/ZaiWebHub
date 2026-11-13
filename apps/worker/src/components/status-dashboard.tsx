'use client';

// apps/worker — Status dashboard (Task 3.6-W)
// Poll GET /api/status mỗi 3s: cards trạng thái + nút Disconnect/Re-configure + log tail 100 dòng.
// KHÔNG hiển thị worker_secret (server không bao giờ trả về client).
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { StatusPayload } from '../worker/status';

const PHASE_META: Record<string, { label: string; cls: string; dot: string }> = {
  online: { label: 'Online', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  registering: { label: 'Registering', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  connecting: { label: 'Connecting', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  reconnecting: { label: 'Reconnecting', cls: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
  stopped: { label: 'Stopped', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200', dot: 'bg-zinc-400' },
};

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(sec / 3600)}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m`;
}

function fmtHeartbeat(ts: number | null): string {
  if (!ts) return 'chưa có';
  const ago = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return ago < 3 ? 'vừa xong' : `${ago}s trước`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-400">{title}</div>
      <div className="mt-1.5 break-words text-sm font-semibold text-zinc-900">{children}</div>
    </div>
  );
}

export default function StatusDashboard({ initial }: { initial: StatusPayload }) {
  const router = useRouter();
  const [status, setStatus] = useState<StatusPayload>(initial);
  const [disconnecting, setDisconnecting] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (res.ok) setStatus((await res.json()) as StatusPayload);
    } catch {
      // lỗi mạng tạm thời — poll kế tiếp
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      void poll();
    }, 3000);
    return () => clearInterval(t);
  }, [poll]);

  async function onDisconnect() {
    setDisconnecting(true);
    try {
      await fetch('/api/disconnect', { method: 'POST' });
    } catch {
      // bỏ qua — refresh sẽ về setup form nếu file đã xoá
    }
    router.refresh();
  }

  const meta = PHASE_META[status.phase] ?? PHASE_META.stopped;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-base font-bold text-white">
            Z
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">ZaiWebHub Worker</h1>
            <p className="text-xs text-zinc-500">Status dashboard — cập nhật tự động mỗi 3 giây</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 shadow-sm transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {disconnecting ? 'Disconnecting...' : 'Disconnect / Re-configure'}
        </button>
      </header>

      {status.last_error && (
        <div
          role="alert"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          <span className="font-semibold">Lỗi gần nhất: </span>
          {status.last_error}
        </div>
      )}

      <section aria-label="Trạng thái worker" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className={`rounded-xl border p-4 shadow-sm ${meta.cls}`}>
          <div className="text-xs font-medium uppercase tracking-wide opacity-70">Status</div>
          <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dot} ${status.phase === 'online' ? 'animate-pulse' : ''}`} aria-hidden="true" />
            {meta.label}
          </div>
        </div>
        <Card title="Worker ID">
          <span className="font-mono">{status.worker_id || '—'}</span>
        </Card>
        <Card title="Hub URL">
          <span className="font-mono text-xs">{status.hub_url || '—'}</span>
        </Card>
        <Card title="Inflight">
          <span className="text-lg">{status.inflight}</span>
          <span className="ml-1 text-xs font-normal text-zinc-400">job đang chạy</span>
        </Card>
        <Card title="Total jobs handled">
          <span className="text-lg">{status.total_jobs}</span>
        </Card>
        <Card title="Uptime">
          {fmtUptime(status.uptime_sec)}
          <span className="ml-2 text-xs font-normal text-zinc-400">(runtime {status.config_source ?? '—'})</span>
        </Card>
        <Card title="Last heartbeat">{fmtHeartbeat(status.last_heartbeat)}</Card>
        <Card title="Upstream / Mode">
          {status.upstream} / {status.mode}
        </Card>
      </section>

      <section aria-label="Log tail" className="flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-zinc-700">Log tail (100 dòng cuối)</h2>
          <span className="text-xs text-zinc-400">worker.log</span>
        </div>
        <pre className="log-scroll max-h-96 overflow-y-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-relaxed text-zinc-700">
          {status.logs.length > 0 ? status.logs.join('\n') : '(chưa có log)'}
        </pre>
      </section>
    </main>
  );
}
