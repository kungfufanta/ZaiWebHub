// apps/dev-console — lib/hub-supervisor.ts (4.0-W)
// Tự supervis hub (:3003) + worker (:3005) từ tiến trình console Next.js (luôn sống trong
// sandbox). Vì sao: sandbox reap MỌI process mồ côi (parent chết) — hub chạy độc lập qua
// `nohup` sẽ bị giết im lặng. Hub/worker là CON của Next dev server (parent luôn sống) →
// tồn tại bền vững; nếu hub/worker chết (crash/OOM) → supervisor tự spawn lại.
//
// Hoạt động:
//  - Probe GET /healthz (hub) + GET /api/health (worker) mỗi 20s.
//  - Không phản hồi → spawn `bun --hot index.ts` trong mini-services/<svc>/, stdout/stderr
//    append vào .zscripts/mini-service-<svc>.log (đúng convention sandbox).
//  - Đã phản hồi → bỏ qua (dev.sh khởi động sẵn lúc boot; owner tự chạy hub riêng cũng OK).
//
// Tắt bằng env: HUB_AUTO_SPAWN=0 / WORKER_AUTO_SPAWN=0 (khi deploy hub/worker trên host khác).
// KHÔNG BAO GIỜ log secret — spawn chỉ kế thừa env của console.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const HUB_DIR = join(ROOT, 'mini-services', 'hub');
const WORKER_DIR = join(ROOT, 'mini-services', 'worker');
const LOG_DIR = join(ROOT, '.zscripts');

const PROBE_TIMEOUT_MS = 1_500;
const SUPERVISOR_INTERVAL_MS = 20_000;

const g = globalThis as typeof globalThis & {
  __zhbSupervisorStarted?: boolean;
  __zhbHubChild?: ChildProcess | null;
  __zhbWorkerChild?: ChildProcess | null;
};

function isEnabled(flag: string): boolean {
  return process.env[flag] !== '0';
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Spawn service con của tiến trình Next (parent sống → sandbox không reap).
 * detached:false + unref() — child sống độc lập event loop của Next nhưng vẫn có parent.
 */
function spawnService(dir: string, logName: string, extraEnv: Record<string, string>): ChildProcess | null {
  if (!existsSync(join(dir, 'index.ts')) || !existsSync(join(dir, 'package.json'))) return null;
  try {
    const logFd = openSync(join(LOG_DIR, logName), 'a');
    const child = spawn('bun', ['--hot', 'index.ts'], {
      cwd: dir,
      stdio: ['ignore', logFd, logFd],
      // Ghì PORT kế thừa từ Next dev (PORT=3000) — service phải giữ port riêng của nó.
      env: { ...process.env, ...extraEnv },
    });
    child.unref();
    child.on('error', () => {
      /* spawn fail — interval sau probe lại và thử spawn tiếp */
    });
    return child;
  } catch {
    return null;
  }
}

export async function ensureHubRunning(): Promise<boolean> {
  if (!isEnabled('HUB_AUTO_SPAWN')) return true;
  if (g.__zhbHubChild && g.__zhbHubChild.exitCode === null && !g.__zhbHubChild.killed) {
    return true; // child ta spawn trước đó còn sống
  }
  const alive = await probe('http://127.0.0.1:3003/healthz');
  if (alive) return true;
  const child = spawnService(HUB_DIR, 'mini-service-hub.log', { PORT: '3003' });
  g.__zhbHubChild = child;
  return Boolean(child);
}

export async function ensureWorkerRunning(): Promise<boolean> {
  if (!isEnabled('WORKER_AUTO_SPAWN')) return true;
  if (g.__zhbWorkerChild && g.__zhbWorkerChild.exitCode === null && !g.__zhbWorkerChild.killed) {
    return true;
  }
  const alive = await probe('http://127.0.0.1:3005/api/health');
  if (alive) return true;
  const child = spawnService(WORKER_DIR, 'mini-service-worker.log', { WORKER_PORT: '3005' });
  g.__zhbWorkerChild = child;
  return Boolean(child);
}

/** Hook 1 lần lúc server boot (src/instrumentation.ts). Idempotent qua globalThis guard. */
export function startServiceSupervisor(): void {
  if (g.__zhbSupervisorStarted) return;
  if (!existsSync(LOG_DIR)) return; // không phải layout sandbox → bỏ qua
  g.__zhbSupervisorStarted = true;
  const tick = (): void => {
    void ensureHubRunning();
    void ensureWorkerRunning();
  };
  tick();
  setInterval(tick, SUPERVISOR_INTERVAL_MS).unref?.();
}
