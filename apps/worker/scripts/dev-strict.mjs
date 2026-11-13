#!/usr/bin/env node
// apps/worker — scripts/dev-strict.mjs (Task 3.6-W)
// STRICT PORT launcher: nếu :3000 đã bận → báo lỗi RÕ RÀNG và thoát (KHÔNG silently đổi port
// như next dev mặc định). Port trống → spawn `next dev -p 3000` kế thừa stdio.
// Launch pattern sandbox (sống qua invocation): ( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )
import net from 'node:net';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.WORKER_PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  console.error(`[worker] FATAL: WORKER_PORT không hợp lệ: ${process.env.WORKER_PORT}`);
  process.exit(1);
}

const probe = net.createServer();
probe.unref();

probe.once('error', () => {
  console.error(
    `[worker] FATAL: port ${PORT} ĐÃ BẬN — từ chối start (strict port, KHÔNG tự đổi port).\n` +
      `  → Xem process đang chiếm port: ss -ltnp | grep ':${PORT}'\n` +
      `  → Kill rồi launch lại, ví dụ: pkill -f 'next dev -p ${PORT}'`,
  );
  process.exit(1);
});

probe.listen(PORT, () => {
  probe.close(() => {
    console.log(`[worker] port ${PORT} trống — starting next dev -p ${PORT} (strict mode)`);
    const child = spawn('node', ['node_modules/.bin/next', 'dev', '-p', String(PORT)], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code ?? 1));
    for (const sig of ['SIGTERM', 'SIGINT']) {
      process.on(sig, () => {
        child.kill(sig);
      });
    }
  });
});
