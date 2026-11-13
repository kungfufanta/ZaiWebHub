'use client';

// Tab /workers — Workers management (3.6-H).
// - Table worker từ GET /api/workers (proxy server-side tới webhub /internal/workers,
//   secret KHÔNG bao giờ xuống client) — poll mỗi 5s.
// - Box "Worker Connection Info": owner paste HUB PUBLIC BASE URL → sinh URL
//   {BASE}/internal/worker-token?XTransformPort=3003 để paste vào worker sandbox.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Check, Copy, RefreshCw, Server } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  buildWorkerTokenUrl,
  fetchWorkersSnapshot,
  relativeTime,
  type WorkersSnapshot,
} from '@/lib/hub-workers';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5_000;
const EMPTY_STATE_TEXT =
  'Chưa có worker nào — deploy worker sandbox và mở :3000 để kết nối';
const CONNECTION_HINT =
  'Mở worker sandbox → :3000 → paste URL này + secret (WORKER_SECRET do owner cấp qua chat) vào form setup của worker.';

export default function WorkersPage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<WorkersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [hubBase, setHubBase] = useState('');
  const [copied, setCopied] = useState(false);
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

  // nhớ HUB PUBLIC BASE URL vào localStorage — owner paste 1 lần
  useEffect(() => {
    const saved = window.localStorage.getItem('hub_public_base');
    if (saved) setHubBase(saved);
  }, []);

  const workerTokenUrl = useMemo(() => buildWorkerTokenUrl(hubBase), [hubBase]);

  const onCopy = useCallback(async () => {
    if (!hubBase.trim()) {
      toast({
        title: 'Chưa có HUB PUBLIC BASE URL',
        description: 'Paste public URL của sandbox hub (vd: https://<hub-host>) vào ô trên trước.',
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(workerTokenUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: 'Đã copy URL worker-token', description: workerTokenUrl });
    } catch {
      toast({
        title: 'Copy thất bại',
        description: 'Browser chặn clipboard — chọn URL bằng tay rồi Ctrl+C.',
      });
    }
  }, [hubBase, workerTokenUrl, toast]);

  const onBaseChange = useCallback((value: string) => {
    setHubBase(value);
    window.localStorage.setItem('hub_public_base', value);
  }, []);

  const now = updatedAt ?? Date.now();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Server className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold sm:text-base">Workers management</h1>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
              Pool worker từ webhub :3003 · poll mỗi 5s
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
            Không lấy được danh sách worker: {error}
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

        {/* ----- Worker Connection Info ----- */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">Worker Connection Info</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Sinh URL worker-token cho worker sandbox mới kết nối vào hub này.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="hub-public-base"
                  className="text-xs font-medium text-muted-foreground"
                >
                  HUB PUBLIC BASE URL (public URL của sandbox hub này)
                </label>
                <Input
                  id="hub-public-base"
                  placeholder="https://<hub-host>"
                  value={hubBase}
                  onChange={(e) => onBaseChange(e.target.value)}
                  className="font-mono text-xs sm:text-sm"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <Button onClick={() => void onCopy()} className="h-10 sm:h-9" aria-label="Copy URL worker token">
                {copied ? (
                  <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                ) : (
                  <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
                )}
                {copied ? 'Đã copy' : 'Copy URL'}
              </Button>
            </div>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                Worker cần paste URL sau vào form setup của nó:
              </p>
              <p className="break-all font-mono text-xs text-foreground sm:text-sm">
                {workerTokenUrl || '…paste HUB PUBLIC BASE URL ở trên để sinh URL'}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">{CONNECTION_HINT}</p>
          </CardContent>
        </Card>

        {/* ----- Workers table ----- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">
              Worker pool
              {snapshot ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {snapshot.workers.filter((w) => w.status === 'online').length} online /{' '}
                  {snapshot.workers.length} tổng · total jobs {snapshot.total_jobs_all_time}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {!snapshot ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Đang tải…</p>
            ) : snapshot.workers.length === 0 ? (
              <div
                className="mx-6 mb-6 rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
                role="status"
              >
                {EMPTY_STATE_TEXT}
              </div>
            ) : (
              <div className="max-h-96 overflow-x-auto overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">worker_id</TableHead>
                      <TableHead>status</TableHead>
                      <TableHead className="text-right">inflight</TableHead>
                      <TableHead className="text-right">total_jobs</TableHead>
                      <TableHead>last_heartbeat</TableHead>
                      <TableHead className="pr-6">capabilities</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {snapshot.workers.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="max-w-[220px] truncate pl-6 font-mono text-xs sm:max-w-[280px] sm:text-sm">
                          {w.id}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              'gap-1.5 font-medium',
                              w.status === 'online'
                                ? 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-400'
                                : 'border-amber-600/40 bg-amber-500/15 text-amber-700 dark:border-amber-500/50 dark:text-amber-400',
                            )}
                            variant="outline"
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                w.status === 'online' ? 'bg-emerald-500' : 'bg-amber-500',
                              )}
                              aria-hidden="true"
                            />
                            {w.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs sm:text-sm">
                          {w.inflight}/{w.capabilities.concurrency}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs sm:text-sm">
                          {w.total_jobs}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                          {relativeTime(w.last_heartbeat, now)}
                        </TableCell>
                        <TableCell className="pr-6 text-xs text-muted-foreground sm:text-sm">
                          <span className="line-clamp-2">
                            {w.capabilities.models.length > 0
                              ? w.capabilities.models.join(', ')
                              : '—'}{' '}
                            · proto v{w.capabilities.protocol_version} · tenant{' '}
                            {w.capabilities.tenant_id}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
          <p className="text-xs text-muted-foreground">
            ZaiWebHub Hub UI — tab Workers · nguồn: webhub :3003 /internal/workers
          </p>
          <p className="hidden font-mono text-[10px] text-muted-foreground md:block">
            <BrainCircuit className="mr-1 inline h-3 w-3" aria-hidden="true" />
            least-loaded dispatch · heartbeat sweep 45s
          </p>
        </div>
      </footer>
    </div>
  );
}
