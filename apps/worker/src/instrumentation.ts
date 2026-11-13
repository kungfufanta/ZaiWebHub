// apps/worker — src/instrumentation.ts (T2-a)
// Boot WS client outbound ĐÚNG 1 LẦN khi Next.js server start (D1: KHÔNG chạy trong request handler).
// NOTE: dùng đúng pattern `if (process.env.NEXT_RUNTIME === 'nodejs') { await import(...) }` —
// NEXT_RUNTIME được Next inline tại build-time (DefinePlugin) nên nhánh edge bị fold bỏ,
// module graph node-only (ws-client → executor → zai-adapter → zsdk/ws) KHÔNG được compile cho edge.
let booted = false;

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (booted) return;
    booted = true;
    try {
      const { startWorker } = await import('./worker/ws-client');
      startWorker();
    } catch (err) {
      booted = false; // cho phép thử lại nếu import thất bại
      console.error('[worker] boot failed:', err instanceof Error ? err.message : err);
    }
  }
}
