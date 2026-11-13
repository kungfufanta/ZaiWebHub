'use client';

// Tab /workers — Workers management (3.6-H).
// - Table worker từ GET /api/workers (proxy server-side tới webhub /internal/workers,
//   secret KHÔNG bao giờ xuống client) — poll mỗi 5s.
// - Box "Worker Connection Info": owner paste HUB PUBLIC BASE URL → sinh URL
//   {BASE}/internal/worker-token?XTransformPort=3003 để paste vào worker sandbox.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Eye, EyeOff, RefreshCw } from 'lucide-react';
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
  TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import {
  buildWorkerTokenUrl,
  fetchWorkersSnapshot,
  relativeTime,
  type WorkersSnapshot } from '@/lib/hub-workers';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 5_000;
const EMPTY_STATE_TEXT =
  'Chưa có worker nào — deploy worker sandbox và mở :3000 để kết nối';
const CONNECTION_HINT =
  'Mở worker sandbox → :3000 → paste URL này + secret (copy WORKER_SECRET bên dưới) vào form setup của worker.';

export function WorkersPanel() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<WorkersSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [hubBase, setHubBase] = useState('');
  const [copied, setCopied] = useState(false);
  const [secret, setSecret] = useState<{ set: boolean; worker_secret: string | null } | null>(null);
  const [secretReveal, setSecretReveal] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
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

  // WORKER_SECRET từ env console (server-side route) — owner copy cho worker khi onboard
  useEffect(() => {
    let alive = true;
    fetch('/api/worker-secret', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (alive && d && typeof d === 'object') {
          setSecret({ set: Boolean(d.set), worker_secret: d.worker_secret ?? null });
        }
      })
      .catch(() => {
        if (alive) setSecret({ set: false, worker_secret: null });
      });
    return () => {
      alive = false;
    };
  }, []);

  const workerTokenUrl = useMemo(() => buildWorkerTokenUrl(hubBase), [hubBase]);

  const onCopy = useCallback(async () => {
    if (!hubBase.trim()) {
      toast({
        title: 'Chưa có HUB PUBLIC BASE URL',
        description: 'Paste public URL của sandbox hub (vd: https://<hub-host>) vào ô trên trước.' });
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
        description: 'Browser chặn clipboard — chọn URL bằng tay rồi Ctrl+C.' });
    }
  }, [hubBase, workerTokenUrl, toast]);

  const onBaseChange = useCallback((value: string) => {
    setHubBase(value);
    window.localStorage.setItem('hub_public_base', value);
  }, []);

  const onCopySecret = useCallback(async () => {
    if (!secret?.worker_secret) return;
    try {
      await navigator.clipboard.writeText(secret.worker_secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 1500);
      toast({ title: 'Đã copy WORKER_SECRET', description: 'Worker fetch /internal/worker-token với header X-Worker-Secret = giá trị này.' });
    } catch {
      toast({ title: 'Copy thất bại', description: 'Browser chặn clipboard — chọn secret bằng tay rồi Ctrl+C.' });
    }
  }, [secret, toast]);

  const now = updatedAt ?? Date.now();

  return (
    <>
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
            {/* WORKER_SECRET — lấy trực tiếp trên UI (env console), mask cho tới khi reveal */}
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  WORKER_SECRET (từ env của hub/console — worker cần cùng giá trị)
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => setSecretReveal((v) => !v)}
                    aria-label={secretReveal ? 'Ẩn WORKER_SECRET' : 'Hiện WORKER_SECRET'}
                    disabled={!secret?.set}
                  >
                    {secretReveal ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {secretReveal ? 'Ẩn' : 'Hiện'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() => void onCopySecret()}
                    aria-label="Copy WORKER_SECRET"
                    disabled={!secret?.set}
                  >
                    {secretCopied ? (
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {secretCopied ? 'Đã copy' : 'Copy'}
                  </Button>
                </div>
              </div>
              <p className="mt-1 break-all font-mono text-xs text-foreground sm:text-sm">
                {!secret ? (
                  'Đang tải secret…'
                ) : !secret.set ? (
                  <span className="text-amber-700 dark:text-amber-400">
                    WORKER_SECRET chưa set trong env console — đặt vào .env.local (khớp webhub :3003) rồi restart console.
                  </span>
                ) : secretReveal ? (
                  secret.worker_secret
                ) : (
                  `••••••••••••••••••••${secret.worker_secret?.slice(-4) ?? ''} (bấm Hiện để xem)`
                )}
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
    </>
  );
}
