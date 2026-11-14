'use client';

// apps/dev-console — components/hub/api-keys-panel.tsx (4.2-K)
// Tab "API Keys" — quản lý Bearer key `zhb_*` owner cấp cho client BÊN NGOÀI gọi hub API
// /v1/* (kiểu OpenAI) với header `Authorization: Bearer <key>`.
// - Danh sách key qua GET /api/api-keys (proxy server-side tới hub :3003 /internal/api-keys,
//   X-Worker-Secret giữ ở server — không bao giờ xuống client) — poll mỗi 10s.
// - Tạo key qua POST /api/api-keys → key NGUYÊN VĂN chỉ hiện ĐÚNG 1 LẦN trong dialog reveal
//   (không log, không lưu localStorage bất kỳ full key nào) — sau đó danh sách chỉ còn prefix mask.
// - Thu hồi key qua DELETE /api/api-keys?id=... (confirm AlertDialog) — client còn dùng sẽ 401 ngay.
// - Key legacy từ env TENANT_KEYS của hub: chỉ đếm + preview mask, không sửa được từ UI.
// SSR-safe: panel chỉ mount client-side (tab restore sau hydration) + relative time gate qua
// `mounted` (useSyncExternalStore — server render '—') → tránh hydration mismatch như workers panel.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { relativeTime } from '@/lib/hub-workers';
import {
  createApiKey,
  fetchApiKeys,
  maskEnvKey,
  revokeApiKey,
  type ApiKeyRow,
  type ApiKeysSnapshot,
} from '@/lib/api-keys';
import { cn } from '@/lib/utils';

const POLL_INTERVAL_MS = 10_000; // poll danh sách key mỗi 10s (key ít đổi hơn workers 5s)
const CLOCK_TICK_MS = 5_000; // tick đồng hồ để relative time tự sống giữa các poll
const MAX_KEY_NAME_LENGTH = 100;
const EMPTY_STATE_TEXT =
  'Chưa có key nào — tạo key đầu tiên để client bên ngoài gọi được hub.';

// useSyncExternalStore — pattern chuẩn của docs-panel: server/hydration render server snapshot,
// sau mount React tự re-render client snapshot — không setState trong effect, không mismatch.
const subscribeNever = () => () => {};
const getOriginSnapshot = () => window.location.origin.replace(/\/+$/, '');
const getOriginServerSnapshot = () => ''; // SSR/chưa mount → giữ placeholder <origin> trong curl
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false; // SSR → render '—' thay vì relative time

/** Sinh ví dụ curl gọi hub /v1/chat/completions (origin trống → giữ placeholder <origin>). */
function buildCurlSnippet(origin: string): string {
  const base = origin || '<origin>';
  return [
    `curl -N ${base}/v1/chat/completions?XTransformPort=3003`,
    '-H "Authorization: Bearer zhb_..."',
    '-H "Content-Type: application/json"',
    `-d '{"model":"glm-5.3","stream":true,"thinking":{"type":"disabled"},"messages":[{"role":"user","content":"Xin chào"}]}'`,
  ].join(' ');
}

export function ApiKeysPanel() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<ApiKeysSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // đồng hồ tick 5s → relative time (row + "cập nhật") tự cập nhật giữa các poll;
  // panel chỉ mount client-side nên Date.now() lúc init không gây hydration mismatch.
  const [clock, setClock] = useState<number>(() => Date.now());
  const [newKeyName, setNewKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  // full key CHỈ sống trong state này trong lúc dialog reveal mở — xoá ngay khi đóng,
  // không log, không ghi localStorage bất kỳ đâu khác.
  const [revealedKey, setRevealedKey] = useState<{ name: string; key: string } | null>(null);
  const [revealOpen, setRevealOpen] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const origin = useSyncExternalStore(subscribeNever, getOriginSnapshot, getOriginServerSnapshot);
  const mounted = useSyncExternalStore(subscribeNever, getMountedSnapshot, getMountedServerSnapshot);

  const load = useCallback(async () => {
    const res = await fetchApiKeys();
    if (res.ok && res.data) {
      setSnapshot(res.data);
      setError(null);
      setUpdatedAt(Date.now());
    } else {
      setError(res.error ?? `HTTP ${res.status}`);
    }
  }, []);

  // poll 10s — cùng pattern workers panel (5s): interval + cleanup trên unmount
  useEffect(() => {
    void load();
    timerRef.current = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  // tick đồng hồ mỗi 5s (setState trong timer callback — không sync trong effect body)
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const curlSnippet = useMemo(() => buildCurlSnippet(origin), [origin]);
  const envPreview = snapshot ? snapshot.env_keys_preview.map((k) => maskEnvKey(k)) : [];
  const activeCount = snapshot ? snapshot.keys.filter((k) => !k.disabled).length : 0;
  const now = clock;

  // ----- copy helpers (pattern workers-panel: Copy/Check swap 1.5s) -----
  const onCopyKey = useCallback(async () => {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey.key);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1500);
      toast({
        title: 'Đã copy key',
        description: 'Lưu vào nơi an toàn (password manager / env của client).',
      });
    } catch {
      toast({
        title: 'Copy thất bại',
        description: 'Browser chặn clipboard — chọn key bằng tay rồi Ctrl+C.',
      });
    }
  }, [revealedKey, toast]);

  const onCopyCurl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(curlSnippet);
      setCurlCopied(true);
      setTimeout(() => setCurlCopied(false), 1500);
      toast({
        title: 'Đã copy ví dụ curl',
        description: 'Thay zhb_... bằng key thật đã tạo ở trên.',
      });
    } catch {
      toast({
        title: 'Copy thất bại',
        description: 'Browser chặn clipboard — chọn lệnh bằng tay rồi Ctrl+C.',
      });
    }
  }, [curlSnippet, toast]);

  // ----- tạo key mới -----
  const doCreate = useCallback(async () => {
    const name = newKeyName.trim();
    if (!name) {
      toast({
        title: 'Chưa nhập tên key',
        description: 'Đặt tên gợi nhớ để biết key này dùng cho app/client nào.',
        variant: 'destructive',
      });
      return;
    }
    setCreating(true);
    try {
      const res = await createApiKey(name);
      if (!res.ok || typeof res.key !== 'string' || res.key.length === 0) {
        toast({
          title: 'Tạo key thất bại',
          description: res.error ?? 'Lỗi không xác định',
          variant: 'destructive',
        });
        return;
      }
      // full key chỉ giữ tạm trong state cho dialog reveal — KHÔNG log, KHÔNG localStorage
      setRevealedKey({ name, key: res.key });
      setKeyCopied(false);
      setRevealOpen(true);
      setNewKeyName('');
      toast({
        title: 'Đã tạo key',
        description: 'Key nguyên văn chỉ hiện một lần — copy và lưu ngay trong dialog.',
      });
    } catch (err) {
      toast({ title: 'Tạo key thất bại', description: String(err), variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  }, [newKeyName, toast]);

  const closeReveal = useCallback(() => {
    setRevealOpen(false);
    // xoá full key khỏi memory NGAY khi đóng — sau đó không xem lại được bằng bất kỳ cách nào
    setRevealedKey(null);
    setKeyCopied(false);
    void load(); // key mới xuất hiện trong danh sách (chỉ còn prefix mask)
  }, [load]);

  // ----- thu hồi key -----
  const doRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await revokeApiKey(revokeTarget.id);
      if (!res.ok) {
        toast({
          title: 'Thu hồi key thất bại',
          description: res.error ?? 'Lỗi không xác định',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Đã thu hồi key',
        description: `“${revokeTarget.name}” (${revokeTarget.prefix}) — client còn dùng key này sẽ bị 401 ngay.`,
      });
      setRevokeTarget(null);
      void load(); // reload danh sách sau mutation
    } catch (err) {
      toast({ title: 'Thu hồi key thất bại', description: String(err), variant: 'destructive' });
    } finally {
      setRevoking(false);
    }
  }, [revokeTarget, load, toast]);

  return (
    <section
      aria-label="Quản lý API Keys"
      className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6"
    >
      {error && (
        <Alert variant="destructive">
          <TriangleAlert aria-hidden="true" />
          <AlertTitle>Không lấy được danh sách key</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="break-all">{error}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => void load()}
              aria-label="Thử lại tải danh sách key"
            >
              <RefreshCw className="mr-1.5 h-3 w-3" aria-hidden="true" /> Thử lại
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* ----- Header: API Keys ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base">API Keys</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Bearer key <code className="font-mono">zhb_*</code> mà client bên ngoài dùng gọi hub
            API <code className="font-mono">/v1/chat/completions</code> với header{' '}
            <code className="font-mono">Authorization: Bearer &lt;key&gt;</code>. Key chỉ hiện
            nguyên văn đúng một lần lúc tạo — sau đó danh sách chỉ còn prefix.
          </CardDescription>
          <CardAction className="flex flex-col items-end gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              aria-label="Làm mới danh sách key"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Làm mới
            </Button>
            <span className="text-[10px] text-muted-foreground sm:text-xs">
              {mounted && updatedAt ? `cập nhật ${relativeTime(updatedAt, now)}` : '—'}
            </span>
          </CardAction>
        </CardHeader>
      </Card>

      {/* ----- Danh sách key ----- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">
            Danh sách key
            {snapshot ? (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {activeCount} đang hoạt động / {snapshot.keys.length} tổng
              </span>
            ) : null}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Prefix chỉ đủ định danh key — không dùng được để gọi API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!snapshot ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : snapshot.keys.length === 0 ? (
            <div
              className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground"
              role="status"
            >
              {EMPTY_STATE_TEXT}
            </div>
          ) : (
            // danh sách dài → scroll trong max-h-96 với thin scrollbar (Tailwind arbitrary classes)
            <div className="max-h-96 overflow-y-auto rounded-md border [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tên</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Tạo lúc</TableHead>
                    <TableHead>Dùng lần cuối</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="text-right">Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell
                        className="max-w-[200px] truncate font-medium text-xs sm:max-w-[260px] sm:text-sm"
                        title={k.name}
                      >
                        {k.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground sm:text-sm">
                        {k.prefix}
                      </TableCell>
                      {/* relative time chỉ tính sau mount (SSR render '—') — tránh hydration mismatch */}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                        {mounted ? relativeTime(k.created_at, now) : '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground sm:text-sm">
                        {mounted && k.last_used_at ? relativeTime(k.last_used_at, now) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'gap-1.5 font-medium',
                            k.disabled
                              ? 'border-stone-400/60 bg-stone-500/10 text-stone-600 dark:border-stone-500/60 dark:text-stone-400'
                              : 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-400',
                          )}
                        >
                          <span
                            className={cn(
                              'h-1.5 w-1.5 rounded-full',
                              k.disabled ? 'bg-stone-400 dark:bg-stone-500' : 'bg-emerald-500',
                            )}
                            aria-hidden="true"
                          />
                          {k.disabled ? 'Đã thu hồi' : 'Đang hoạt động'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {k.disabled ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => setRevokeTarget(k)}
                            aria-label={`Thu hồi key ${k.name}`}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Thu hồi
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----- Tạo key mới ----- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm sm:text-base">Tạo key mới</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Đặt tên gợi nhớ cho app/client sẽ dùng key. Key tạo xong hiển thị nguyên văn đúng một
            lần trong dialog.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void doCreate();
            }}
          >
            <div className="space-y-1.5">
              <label
                htmlFor="new-key-name"
                className="text-xs font-medium text-muted-foreground"
              >
                Tên key
              </label>
              <Input
                id="new-key-name"
                placeholder="vd: key cho app mobile"
                value={newKeyName}
                maxLength={MAX_KEY_NAME_LENGTH}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="text-xs sm:text-sm"
                autoComplete="off"
                spellCheck={false}
                disabled={creating}
              />
            </div>
            <Button
              type="submit"
              className="h-10 sm:h-9"
              disabled={creating}
              aria-label="Tạo key mới"
            >
              {creating ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <KeyRound className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Tạo key
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ----- Key legacy từ env TENANT_KEYS (chỉ đọc) ----- */}
      {snapshot && snapshot.env_key_count > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm sm:text-base">
              Key legacy từ env
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {snapshot.env_key_count} key
              </span>
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Key legacy từ env TENANT_KEYS của hub — quản lý bằng env, không sửa được tại đây.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground sm:text-sm">
                {envPreview.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ----- Ví dụ gọi API từ bên ngoài ----- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm sm:text-base">Gọi API từ bên ngoài</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Ví dụ curl stream tới hub này — thay <code className="font-mono">zhb_...</code> bằng
            key thật đã tạo ở trên.
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onCopyCurl()}
              aria-label="Copy ví dụ curl"
            >
              {curlCopied ? (
                <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              )}
              {curlCopied ? 'Đã copy' : 'Copy'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <pre className="max-w-full overflow-x-auto rounded-md border bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
            {curlSnippet}
          </pre>
          <p className="mt-2 text-xs text-muted-foreground">
            <code className="font-mono">-N</code> tắt buffer của curl để nhận token stream (SSE)
            realtime.
          </p>
        </CardContent>
      </Card>

      {/* ----- Dialog reveal key NGUYÊN VĂN — chỉ hiện đúng 1 lần lúc tạo ----- */}
      <Dialog
        open={revealOpen}
        onOpenChange={(open) => {
          if (!open) closeReveal();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Key đã tạo — copy ngay</DialogTitle>
            <DialogDescription>
              Chỉ hiện MỘT LẦN — copy và lưu ngay, sau đó sẽ chỉ thấy prefix.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/40 px-3 py-2.5">
              <p
                className="break-all font-mono text-xs text-foreground sm:text-sm"
                aria-label="Key API mới (nguyên văn)"
              >
                {revealedKey?.key ?? ''}
              </p>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Key nguyên văn cho “{revealedKey?.name ?? ''}” — hub không lưu bản nào khác, đóng
              dialog này là không xem lại được.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeReveal}>
              Đã lưu — đóng
            </Button>
            <Button onClick={() => void onCopyKey()} aria-label="Copy key vừa tạo">
              {keyCopied ? (
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              {keyCopied ? 'Đã copy' : 'Copy key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----- Confirm thu hồi key ----- */}
      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Thu hồi key này?</AlertDialogTitle>
            <AlertDialogDescription>
              Key “{revokeTarget?.name ?? ''}” ({revokeTarget?.prefix ?? ''}) sẽ bị vô hiệu NGAY.
              Client đang dùng key này sẽ bị 401 ở request kế tiếp. Không hoàn tác — muốn cấp lại
              thì tạo key mới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void doRevoke();
              }}
            >
              {revoking ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> Đang thu
                  hồi…
                </>
              ) : (
                'Thu hồi key'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
