'use client';

// apps/worker — Setup form (Task 3.6-W)
// Paste hub URL + worker_id + secret → POST /api/setup → poll /api/status tới khi registered
// → router.refresh() chuyển sang status dashboard. Secret chỉ đi qua POST, không bao giờ hiển thị lại.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function SetupForm({ defaultWorkerId }: { defaultWorkerId: string }) {
  const router = useRouter();
  const [hubUrl, setHubUrl] = useState('');
  const [workerId, setWorkerId] = useState(defaultWorkerId);
  const [secret, setSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    setProgressText(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_url: hubUrl, worker_id: workerId, worker_secret: secret }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Setup thất bại (HTTP ${res.status})`);
        setSubmitting(false);
        return;
      }
      // Runtime đã start — poll tới khi registered (hoặc hết ~15s thì vẫn refresh để dashboard hiện lỗi chi tiết)
      setProgressText('Registering with hub...');
      const deadline = Date.now() + 15_000;
      let registered = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const s = await fetch('/api/status', { cache: 'no-store' });
          const st = (await s.json()) as { connected?: boolean; registered?: boolean };
          if (st.registered) {
            registered = true;
            break;
          }
        } catch {
          // bỏ qua — poll tiếp
        }
      }
      setProgressText(registered ? 'Registered — đang mở dashboard...' : 'Đang mở dashboard (xem lỗi nếu có)...');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lỗi mạng khi gọi /api/setup');
      setSubmitting(false);
      setProgressText(null);
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 shadow-sm outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-100';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mb-2 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-900 text-lg font-bold text-white">
            Z
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">ZaiWebHub Worker</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Kết nối sandbox này vào worker-pool hub — điền 1 lần, tự connect outbound.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          aria-label="Worker setup form"
        >
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          <label htmlFor="hub_url" className="mb-1 block text-sm font-medium text-zinc-700">
            Hub URL
          </label>
          <input
            id="hub_url"
            name="hub_url"
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            required
            disabled={submitting}
            value={hubUrl}
            onChange={(e) => setHubUrl(e.target.value)}
            placeholder="https://preview-xxx.space-z.ai"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Lấy URL từ tab Workers của hub dashboard. Nếu hub chạy sau gateway sandbox, giữ nguyên
            query (ví dụ <code className="rounded bg-zinc-100 px-1 font-mono">?XTransformPort=3003</code>).
          </p>

          <label htmlFor="worker_id" className="mb-1 mt-4 block text-sm font-medium text-zinc-700">
            Worker ID
          </label>
          <input
            id="worker_id"
            name="worker_id"
            type="text"
            required
            disabled={submitting}
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            placeholder="w1-<hostname>"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-xs text-zinc-500">Pre-fill theo hostname sandbox — có thể sửa.</p>

          <label htmlFor="worker_secret" className="mb-1 mt-4 block text-sm font-medium text-zinc-700">
            Worker Secret
          </label>
          <input
            id="worker_secret"
            name="worker_secret"
            type="password"
            autoComplete="off"
            required
            disabled={submitting}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="••••••••••••"
            className={`${inputCls} font-mono`}
          />
          <p className="mt-1 text-xs text-zinc-500">
            Shared secret do owner cấp qua chat — lưu vào <code className="font-mono">.worker-config.json</code>{' '}
            (gitignored), không bao giờ hiển thị lại.
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 w-full rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Connecting...' : 'Connect'}
          </button>

          {progressText && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-zinc-600" aria-live="polite">
              <span
                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700"
                aria-hidden="true"
              />
              {progressText}
            </div>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-zinc-400">
          Mode headless (env HUB_URL + WORKER_ID + WORKER_SECRET) vẫn hỗ trợ — env ưu tiên hơn file.
        </p>
      </div>
    </main>
  );
}
