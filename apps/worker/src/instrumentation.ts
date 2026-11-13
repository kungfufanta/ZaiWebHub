// apps/worker — src/instrumentation.ts (T2-a + Task 3.6-W)
// Boot handler khi Next.js server start (D1: KHÔNG chạy trong request handler):
//   - đọc config (env > file .worker-config.json) → có → start runtime WS (singleton)
//   - không có → KHÔNG start WS — serve SETUP UI ở / (user paste hub URL + secret qua form)
// NOTE: pattern `if (process.env.NEXT_RUNTIME === 'nodejs') { await import(...) }` —
// NEXT_RUNTIME được Next inline tại build-time (DefinePlugin) nên nhánh edge bị fold bỏ,
// module graph node-only (ws-client → executor → zai-adapter → zsdk/ws, file-config → node:fs)
// KHÔNG được compile cho edge.
let booted = false;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (booted) return;
    booted = true;
    try {
      const { resolveBootConfig } = await import('./worker/file-config');
      const boot = await resolveBootConfig();
      if (!boot) {
        console.log(
          '[worker] [info] no worker config (env + .worker-config.json) — SETUP UI mode, WS not started',
        );
        return;
      }
      const { startRuntime } = await import('./worker/ws-client');
      startRuntime(boot.config, boot.source);
    } catch (err) {
      booted = false; // cho phép thử lại nếu import thất bại
      console.error('[worker] boot failed:', err instanceof Error ? err.message : err);
    }
  }
}
