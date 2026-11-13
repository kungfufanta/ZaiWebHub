'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  LogOut,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Timer,
  Unplug,
} from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  fetchWorkerStatus,
  formatUptime,
  relTime,
  submitDisconnect,
  submitSetup,
  WORKER_SERVICE_PORT,
  type WorkerPhase,
  type WorkerStatus,
} from '@/lib/worker';

// ---------- helpers ----------
const PHASE_META: Record<WorkerPhase, { label: string; dot: string; badge: string; pulse?: boolean }> = {
  online: {
    label: 'Online',
    dot: 'bg-emerald-500',
    badge: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  },
  registering: {
    label: 'Registering',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    pulse: true,
  },
  connecting: {
    label: 'Connecting',
    dot: 'bg-amber-500',
    badge: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
    pulse: true,
  },
  reconnecting: {
    label: 'Reconnecting',
    dot: 'bg-orange-500',
    badge: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30',
    pulse: true,
  },
  stopped: {
    label: 'Stopped',
    dot: 'bg-muted-foreground/50',
    badge: 'bg-muted text-muted-foreground border-border',
  },
};

function PhaseBadge({ phase }: { phase: WorkerPhase }) {
  const meta = PHASE_META[phase] ?? PHASE_META.stopped;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${meta.badge}`}
      role="status"
      aria-label={`Worker status: ${meta.label}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${meta.dot} ${meta.pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      {meta.label}
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={`mt-1.5 truncate text-sm font-semibold ${mono ? 'font-mono text-[13px]' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
    </div>
  );
}

// ---------- setup form ----------
function SetupForm({
  hostname,
  onSubmit,
  submitting,
  error,
}: {
  hostname: string;
  onSubmit: (v: { hub_url: string; worker_id: string; worker_secret: string }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [hubUrl, setHubUrl] = useState('');
  // null = chưa đụng vào → derive prefill theo hostname (giống repo gốc: w1-<hostname>)
  const [workerIdDraft, setWorkerIdDraft] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const workerId = workerIdDraft ?? (hostname ? `w1-${hostname}` : '');

  const valid =
    hubUrl.trim().length > 0 &&
    workerId.trim().length > 0 &&
    secret.length >= 8;

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader className="text-center">
        <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Server className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <CardTitle className="text-lg">ZaiWebHub Worker</CardTitle>
        <CardDescription>
          Kết nối sandbox này vào worker-pool của hub. Runtime chạy outbound WebSocket —
          sandbox <span className="font-medium">không cần inbound</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="hub-url">Hub URL</Label>
          <Input
            id="hub-url"
            placeholder="https://preview-xxx.space-z.ai/?XTransformPort=3003"
            value={hubUrl}
            onChange={(e) => setHubUrl(e.target.value)}
            autoComplete="url"
            inputMode="url"
          />
          <p className="text-xs text-muted-foreground">
            URL công cộng của hub — lấy từ tab Workers của hub dashboard. Nếu hub sau gateway
            sandbox, giữ nguyên query (vd <span className="font-mono">?XTransformPort=3003</span>).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="worker-id">Worker ID</Label>
          <Input
            id="worker-id"
            placeholder="w1-<hostname>"
            value={workerId}
            onChange={(e) => setWorkerIdDraft(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Duy nhất mỗi sandbox — pre-fill sẵn, sửa prefix theo vai trò (w1-, w2-…).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="worker-secret">Worker Secret</Label>
          <div className="relative">
            <Input
              id="worker-secret"
              type={showSecret ? 'text' : 'password'}
              placeholder="••••••••••••"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoComplete="off"
              className="pr-10"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={showSecret ? 'Ẩn secret' : 'Hiện secret'}
            >
              {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Shared secret do owner cấp — chỉ gửi tới hub qua header X-Worker-Secret, không bao giờ
            hiển thị lại.
          </p>
        </div>

        <Button
          className="w-full"
          disabled={!valid || submitting}
          onClick={() => onSubmit({ hub_url: hubUrl, worker_id: workerId, worker_secret: secret })}
        >
          {submitting ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Registering with hub…
            </>
          ) : (
            <>
              <ArrowUpRight className="mr-2 h-4 w-4" aria-hidden="true" />
              Connect
            </>
          )}
        </Button>

        <Separator className="my-2" />

        <ol className="space-y-2 text-xs text-muted-foreground">
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">1.</span>
            Dán Hub URL công cộng (kèm query gateway nếu hub sau sandbox gateway).
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">2.</span>
            Worker mở WS outbound tới hub, đăng ký capabilities + heartbeat 15s.
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-foreground">3.</span>
            Nhận job.dispatch → gọi zsdk (backend) → stream SSE bytes nguyên xi về hub.
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}

// ---------- log tail ----------
function LogTail({ logs }: { logs: string[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);
  return (
    <div
      ref={boxRef}
      className="max-h-96 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-5 text-muted-foreground [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-2"
      aria-label="Worker log tail"
      aria-live="polite"
    >
      {logs.length === 0 ? (
        <p className="text-center italic">(chưa có log)</p>
      ) : (
        logs.map((line, i) => (
          <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))
      )}
    </div>
  );
}

// ---------- dashboard ----------
function Dashboard({
  status,
  onDisconnect,
  disconnecting,
}: {
  status: WorkerStatus;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Status dashboard</CardTitle>
            <CardDescription>Cập nhật tự động mỗi 3 giây</CardDescription>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={disconnecting}>
                <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
                Disconnect / Re-configure
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Ngắt kết nối worker?</AlertDialogTitle>
                <AlertDialogDescription>
                  Runtime WS sẽ dừng, in-flight job bị drop (hub owns at-most-once) và config file
                  bị xoá. Bạn sẽ quay lại màn hình setup.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Huỷ</AlertDialogCancel>
                <AlertDialogAction onClick={onDisconnect} className="bg-destructive text-white hover:bg-destructive/90">
                  <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <PhaseBadge phase={status.phase} />
            {status.last_error && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate" title={status.last_error}>
                  {status.last_error}
                </span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              icon={<ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              label="WORKER ID"
              value={status.worker_id || '—'}
              mono
            />
            <StatCard
              icon={<Globe className="h-3.5 w-3.5" aria-hidden="true" />}
              label="HUB URL"
              value={status.hub_url || '—'}
              mono
            />
            <StatCard
              icon={<Activity className="h-3.5 w-3.5" aria-hidden="true" />}
              label="INFLIGHT"
              value={`${status.inflight} job`}
            />
            <StatCard
              icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
              label="TOTAL JOBS"
              value={status.total_jobs}
            />
            <StatCard
              icon={<Timer className="h-3.5 w-3.5" aria-hidden="true" />}
              label="UPTIME (runtime)"
              value={formatUptime(status.uptime_sec)}
            />
            <StatCard
              icon={<Radio className="h-3.5 w-3.5" aria-hidden="true" />}
              label="LAST HEARTBEAT"
              value={relTime(status.last_heartbeat)}
            />
            <StatCard
              icon={<Server className="h-3.5 w-3.5" aria-hidden="true" />}
              label="UPSTREAM / MODE"
              value={`${status.upstream} / ${status.mode}`}
            />
            <StatCard
              icon={<Gauge className="h-3.5 w-3.5" aria-hidden="true" />}
              label="CONCURRENCY"
              value={status.concurrency}
            />
          </div>

          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
            <p className="truncate">
              <span className="font-medium text-foreground">WS:</span>{' '}
              <span className="font-mono">{status.hub_ws_url || '—'}</span>
            </p>
            <p className="truncate">
              <span className="font-medium text-foreground">Token URL:</span>{' '}
              <span className="font-mono">{status.hub_token_url || '—'}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Tenant:</span>{' '}
              <span className="font-mono">{status.tenant_id}</span>
              <span className="mx-2">·</span>
              <span className="font-medium text-foreground">Models:</span>{' '}
              <span className="font-mono">{status.models.join(', ')}</span>
            </p>
            <p>
              <span className="font-medium text-foreground">Protocol:</span>{' '}
              <span className="font-mono">v{status.protocol_version}</span>
              <span className="mx-2">·</span>
              <span className="font-medium text-foreground">Config:</span>{' '}
              <span className="font-mono">{status.config_source ?? '—'}</span>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="h-4 w-4" aria-hidden="true" />
            Log tail
          </CardTitle>
          <CardDescription>100 dòng cuối từ ring buffer của runtime (300 max)</CardDescription>
        </CardHeader>
        <CardContent>
          <LogTail logs={status.logs} />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- page ----------
export function WorkerPanel() {
  const { toast } = useToast();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [serviceOk, setServiceOk] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await fetchWorkerStatus();
      setStatus(s);
      setServiceOk(true);
    } catch {
      setServiceOk(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 3000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refresh]);

  const handleSetup = async (v: { hub_url: string; worker_id: string; worker_secret: string }) => {
    setSubmitting(true);
    setSetupError(null);
    try {
      const res = await submitSetup(v);
      if (res.ok) {
        toast({ title: 'Đã lưu config', description: 'Runtime WS đang khởi động — connect ra hub…' });
        await refresh();
      } else {
        setSetupError(res.error ?? 'Setup thất bại');
      }
    } catch {
      setSetupError('Không gọi được worker service — kiểm tra mini-service :3005 đã chạy chưa');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await submitDisconnect();
      if (res.ok) {
        toast({ title: 'Đã disconnect', description: 'Runtime dừng + config đã xoá.' });
      } else {
        toast({ title: 'Disconnect lỗi', description: res.error, variant: 'destructive' });
      }
      await refresh();
    } finally {
      setDisconnecting(false);
    }
  };

  const loading = serviceOk === null || (serviceOk && !status);
  const phase = status?.phase ?? 'stopped';

  return (
    <>
{/* Main */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {serviceOk === false && (
          <Alert variant="destructive" className="mb-6" role="alert">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Không kết nối được worker service (port {WORKER_SERVICE_PORT})</AlertTitle>
            <AlertDescription>
              Runtime WS là mini-service Bun độc lập. Khởi động lại bằng:{' '}
              <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-[12px]">
                cd mini-services/worker && bun run dev
              </code>
              — dashboard sẽ tự thử lại mỗi 3 giây.
            </AlertDescription>
          </Alert>
        )}

        {loading && (
          <div className="mx-auto w-full max-w-xl space-y-4">
            <Skeleton className="mx-auto h-12 w-12 rounded-xl" />
            <Skeleton className="mx-auto h-6 w-48" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {!loading && status && !status.configured && (
          <SetupForm
            hostname={status.hostname}
            onSubmit={(v) => void handleSetup(v)}
            submitting={submitting}
            error={setupError}
          />
        )}

        {!loading && status && status.configured && (
          <Dashboard status={status} onDisconnect={() => void handleDisconnect()} disconnecting={disconnecting} />
        )}
      </main>

    </>
  );
}
