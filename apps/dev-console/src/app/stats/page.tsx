'use client';

// Tab /stats — Stats overview (3.6-H): uptime, total jobs, workers online,
// jobs per worker bar chart (CSS thuần, không lib chart). Poll mỗi 5s.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Clock, Gauge, RefreshCw, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fetchWorkersSnapshot,
  formatUptime,
  relativeTime,
  type WorkersSnapshot,
} from '@/lib/hub-workers';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5_000;

export default function StatsPage() {
  const [snapshot, setSnapshot] = useState<WorkersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    const res = await fetchWorkersSnapshot();
    if (res.ok && res.data) {
      setSnapshot(res.data);
      setError(null);
      setUpdatedAt(Date.now());
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const workers = snapshot?.workers ?? [];
  const online = workers.filter((w) => w.status === 'online');
  const maxJobs = Math.max(1, ...workers.map((w) => w.total_jobs));
  const now = updatedAt ?? Date.now();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Gauge className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold sm:text-base">Stats overview</h1>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
              Sức khỏe hub :3003 · poll mỗi 5s
              {updatedAt ? ` · cập nhật ${new Date(updatedAt).toLocaleTimeString('vi-VN')}` : ''}
            </p>
          </div>
          <Badge variant="outline" className="ml-auto shrink-0 font-mono text-[10px]">
            GET /internal/workers
          </Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive sm:text-sm"
          >
            Không lấy được số liệu: {error}
            <Button
              variant="outline"
              size="sm"
              className="ml-3 h-7"
              onClick={() => void load()}
              aria-label="Thử lại"
            >
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> Thử lại
            </Button>
          </div>
        )}

        {/* ----- 3 số liệu tổng ----- */}
        <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Uptime hub
              </CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums sm:text-3xl">
                {snapshot ? formatUptime(snapshot.uptime_seconds) : '—'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-xs text-muted-foreground">
              từ lúc webhub :3003 boot
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <Server className="h-3.5 w-3.5" aria-hidden="true" /> Workers online
              </CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums sm:text-3xl">
                {snapshot ? `${online.length}/${workers.length}` : '—'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-xs text-muted-foreground">
              online / tổng trong snapshot (kể cả offline gần đây)
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <Activity className="h-3.5 w-3.5" aria-hidden="true" /> Total jobs all time
              </CardDescription>
              <CardTitle className="font-mono text-2xl tabular-nums sm:text-3xl">
                {snapshot ? snapshot.total_jobs_all_time : '—'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4 text-xs text-muted-foreground">
              số job duy nhất đã tới tay worker (job.ack)
            </CardContent>
          </Card>
        </div>

        {/* ----- Jobs per worker — bar chart CSS ----- */}
        <Card className="mt-4 sm:mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">Jobs per worker</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Tổng job đã xử lý theo từng worker (thanh tỉ lệ theo max)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!snapshot ? (
              <p className="text-sm text-muted-foreground">Đang tải…</p>
            ) : workers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Chưa có worker nào — chưa có số liệu job.
              </p>
            ) : (
              <ul className="space-y-3" aria-label="Jobs per worker">
                {workers.map((w) => {
                  const pct = Math.round((w.total_jobs / maxJobs) * 100);
                  return (
                    <li key={w.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs sm:text-sm">
                        <span className="min-w-0 truncate font-mono" title={w.id}>
                          {w.id}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {w.total_jobs} jobs · inflight {w.inflight} ·{' '}
                          {relativeTime(w.last_heartbeat, now)}
                        </span>
                      </div>
                      <div
                        className="h-3 w-full overflow-hidden rounded-full bg-muted"
                        role="img"
                        aria-label={`${w.id}: ${w.total_jobs} jobs`}
                      >
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width] duration-500',
                            w.status === 'online'
                              ? 'bg-emerald-500/80'
                              : 'bg-amber-500/80',
                          )}
                          style={{ width: `${Math.max(pct, w.total_jobs > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
          <p className="text-xs text-muted-foreground">
            ZaiWebHub Hub UI — tab Stats · nguồn: webhub :3003 /internal/workers
          </p>
          <p className="hidden font-mono text-[10px] text-muted-foreground md:block">
            registry + stats quan sát · byte-blind F6
          </p>
        </div>
      </footer>
    </div>
  );
}
