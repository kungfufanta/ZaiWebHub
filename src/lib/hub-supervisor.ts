// src/lib/hub-supervisor.ts (4.0-W / 4.4-P prod-deploy fix)
// Tự supervis hub (:3003) + worker (:3005) từ tiến trình console Next.js (luôn sống).
// Vì sao: sandbox/platform reap MỌI process mồ côi (parent chết) — hub chạy độc lập qua
// `nohup` sẽ bị giết im lặng. Hub/worker là CON của server Next (parent luôn sống) →
// tồn tại bền vững; nếu hub/worker chết (crash/OOM) → supervisor tự spawn lại.
//
// 4.4-P (fix deploy prod trắng trang / chết âm thầm):
//  - Gate CŨ `existsSync(cwd/.zscripts)` SAI cho deploy mới: .zscripts là runtime
//    platform-managed + gitignored → clone/deploy mới không bao giờ có → supervisor
//    KHÔNG BAO GIỜ chạy → hub/worker chết yểu, chức năng chat "không hoạt động trên prod".
//    Gate MỚI: nhận diện layout repo chuẩn (mini-services/hub/index.ts tồn tại).
//  - ROOT CŨ = process.cwd() SAI khi chạy standalone prod (`bun .next/standalone/server.js`
//    chdir vào .next/standalone) → resolve root bằng walk-up + override env WEBHUB_ROOT.
//  - Spawn prod dùng `bun index.ts` (không --hot — tránh stale module state khi relay dài).
//  - Log spawn ghi vào mini-services/<svc>/dev.log (thay .zscripts/* đã bỏ).
//
// Hoạt động:
//  - Probe GET /healthz (hub) + GET /api/health (worker) mỗi 20s.
//  - Không phản hồi → spawn bun (dev: `--hot`) trong mini-services/<svc>/, stdout/stderr
//    append vào <svc>/dev.log; mỗi lần spawn ghi 1 dòng marker `[supervisor]` để truy vết.
//  - Đã phản hồi → bỏ qua (platform/dev.sh khởi động sẵn lúc boot; owner tự chạy riêng cũng OK).
//
// Tắt bằng env: HUB_AUTO_SPAWN=0 / WORKER_AUTO_SPAWN=0 (khi deploy hub/worker trên host khác).
// Chỉ định root khác: WEBHUB_ROOT=/path/to/repo (hosting đặt repo ở vị trí lạ).
// KHÔNG BAO GIỜ log secret — spawn chỉ kế thừa env của console.
//
// 4.4-Q (deploy-aware spawn cho FC prod): trên deploy, mini-services được platform bundle
// thành /app/mini-services-dist/mini-service-*.js và mini-services-start.sh (platform)
// chạy chúng MỘT LẦN lúc boot — chết là chết hẳn (không ai restart). Supervisor giờ nhận
// diện cả layout prod: nếu không còn source (mini-services/hub/index.ts) nhưng có bundle
// → spawn lại `bun mini-services-dist/mini-service-<svc>.js` với env file-runtime tường minh
// (API_KEYS_FILE / WORKER_SECRET_FILE / WORKER_CONFIG_FILE) để mọi process cùng nhìn 1 .runtime.
import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { findDeployRoot, runtimeDir } from './runtime-paths';

const PROBE_TIMEOUT_MS = 1_500;
const SUPERVISOR_INTERVAL_MS = 20_000;
const HUB_PORT = process.env.HUB_INTERNAL_PORT || '3003';
const WORKER_SERVICE_PORT = process.env.WORKER_SERVICE_PORT || '3005';

const HUB_INDEX_REL = ['mini-services', 'hub', 'index.ts'];
// 4.4-Q: hub bundle KHÔNG đọc process.env.PORT (start.sh platform export PORT=3000 cho
// Next — nếu kế thừa, hub listen trùng :3000 và chết vì EADDRINUSE). Port chỉ qua env này.
const HUB_PORT_ENV = 'HUB_INTERNAL_PORT';

const g = globalThis as typeof globalThis & {
  __zhbSupervisorStarted?: boolean;
  __zhbRepoRoot?: string;
  __zhbDeploy?: { root: string; prodLayout: boolean };
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
 * Tìm thư mục gốc repo chứa mini-services/ — đúng cho MỌI chế độ chạy:
 *  - dev từ root: cwd = root → tìm thấy ngay (walk-up dừng ở cấp 0).
 *  - prod standalone (`bun .next/standalone/server.js`): server chdir vào
 *    .next/standalone → walk-up tối đa 6 cấp tìm lại root thực.
 *  - hosting đặt repo ở vị trí lạ: set WEBHUB_ROOT=/path/to/repo (ưu tiên cao nhất).
 * Không tìm thấy → trả về cwd (gate ở caller sẽ loại).
 */
export function resolveRepoRoot(): string {
  const envRoot = process.env.WEBHUB_ROOT?.trim();
  if (envRoot) return envRoot;
  const candidates: string[] = [];
  let cur = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    candidates.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break; // chạm gốc filesystem
    cur = parent;
  }
  for (const dir of candidates) {
    if (existsSync(join(dir, ...HUB_INDEX_REL))) return dir;
  }
  return process.cwd();
}

/** 4.4-Q: root deploy-aware — cache 1 lần. */
function deployRoot(): { root: string; prodLayout: boolean } {
  if (!g.__zhbDeploy) g.__zhbDeploy = findDeployRoot();
  return g.__zhbDeploy;
}

/**
 * Spawn service con từ SOURCE (dev/sandbox — mini-services/<svc>/index.ts tồn tại).
 * detached:false + unref() — child sống độc lập event loop của Next nhưng vẫn có parent.
 * dev (`NODE_ENV !== 'production'`): `bun --hot index.ts`; prod: `bun index.ts`.
 * (export để test được đường spawn thật — không có tác dụng phụ khi dir không hợp lệ)
 */
export function spawnService(dir: string, extraEnv: Record<string, string>): ChildProcess | null {
  if (!existsSync(join(dir, 'index.ts')) || !existsSync(join(dir, 'package.json'))) return null;
  try {
    const logPath = join(dir, 'dev.log');
    mkdirSync(dir, { recursive: true });
    const args = process.env.NODE_ENV === 'production' ? ['index.ts'] : ['--hot', 'index.ts'];
    appendFileSync(logPath, `[supervisor] spawn bun ${args.join(' ')} (cwd=${dir})\n`);
    const logFd = openSync(logPath, 'a');
    const child = spawn('bun', args, {
      cwd: dir,
      stdio: ['ignore', logFd, logFd],
      // Ghì PORT kế thừa từ server Next (PORT=3000) — service phải giữ port riêng của nó.
      env: { ...process.env, ...extraEnv },
    });
    child.unref();
    child.on('error', () => {
      /* spawn fail (thiếu bun…) — interval sau probe lại và thử spawn tiếp */
    });
    return child;
  } catch {
    return null;
  }
}

/**
 * 4.4-Q: Spawn service từ BUNDLE platform (FC deploy — /app/mini-services-dist/mini-service-*.js).
 * mini-services-start.sh của platform chỉ chạy 1 lần lúc boot; bundle chết = chết hẳn —
 * supervisor là tiến trình duy nhất có thể restart. Log ghi cạnh bundle để dễ soi.
 */
export function spawnBundle(bundlePath: string, logDir: string, extraEnv: Record<string, string>): ChildProcess | null {
  if (!existsSync(bundlePath)) return null;
  try {
    const logPath = join(logDir, `${(bundlePath.split('/').pop() ?? 'service').replace(/\.js$/, '')}.log`);
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logPath, `[supervisor] spawn bun ${bundlePath} (cwd=${dirname(bundlePath)})\n`);
    const logFd = openSync(logPath, 'a');
    const child = spawn('bun', [bundlePath], {
      cwd: dirname(bundlePath),
      stdio: ['ignore', logFd, logFd],
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
  const alive = await probe(`http://127.0.0.1:${HUB_PORT}/healthz`);
  if (alive) return true;
  const root = deployRoot().root;
  // 1) SOURCE layout (sandbox/dev) — spawn từ source, port qua HUB_INTERNAL_PORT
  //    (4.4-Q: hub không đọc PORT nữa nên env cũ `PORT:` mất tác dụng).
  const srcDir = join(root, 'mini-services', 'hub');
  const child =
    existsSync(join(srcDir, 'index.ts'))
      ? spawnService(srcDir, { [HUB_PORT_ENV]: HUB_PORT })
      : // 2) BUNDLE layout (FC deploy) — spawn lại bundle platform + neo file runtime tường minh
        spawnBundle(join(root, 'mini-services-dist', 'mini-service-hub.js'), join(root, 'mini-services-dist'), {
          [HUB_PORT_ENV]: HUB_PORT,
          API_KEYS_FILE: join(runtimeDir(), 'api-keys.json'),
          WORKER_SECRET_FILE: join(runtimeDir(), 'worker-secret.json'),
        });
  g.__zhbHubChild = child;
  return Boolean(child);
}

export async function ensureWorkerRunning(): Promise<boolean> {
  if (!isEnabled('WORKER_AUTO_SPAWN')) return true;
  if (g.__zhbWorkerChild && g.__zhbWorkerChild.exitCode === null && !g.__zhbWorkerChild.killed) {
    return true;
  }
  const alive = await probe(`http://127.0.0.1:${WORKER_SERVICE_PORT}/api/health`);
  if (alive) return true;
  const root = deployRoot().root;
  const srcDir = join(root, 'mini-services', 'worker');
  const child =
    existsSync(join(srcDir, 'index.ts'))
      ? spawnService(srcDir, { WORKER_PORT: WORKER_SERVICE_PORT })
      : spawnBundle(join(root, 'mini-services-dist', 'mini-service-worker.js'), join(root, 'mini-services-dist'), {
          WORKER_PORT: WORKER_SERVICE_PORT,
          WORKER_CONFIG_FILE: join(root, 'worker-config.json'),
          WORKER_SECRET_FILE: join(runtimeDir(), 'worker-secret.json'),
        });
  g.__zhbWorkerChild = child;
  return Boolean(child);
}

/** Hook 1 lần lúc server boot (src/instrumentation.ts). Idempotent qua globalThis guard. */
export function startServiceSupervisor(): void {
  if (g.__zhbSupervisorStarted) return;
  // Gate layout WebHub — nhận DIỆN CẢ 2 layout (4.4-Q):
  //  - repo   : mini-services/hub/index.ts      (sandbox dev + standalone chạy trong repo)
  //  - bundle : mini-services-dist/mini-service-hub.js (FC deploy — platform đã bundle)
  // KHÔNG theo .zscripts (runtime platform-managed, gitignored → deploy mới không có).
  const { root } = deployRoot();
  const hasSource = existsSync(join(root, ...HUB_INDEX_REL));
  const hasBundle = existsSync(join(root, 'mini-services-dist', 'mini-service-hub.js'));
  if (!hasSource && !hasBundle) return; // không phải repo WebHub → bỏ qua
  g.__zhbSupervisorStarted = true;
  const tick = (): void => {
    void ensureHubRunning();
    void ensureWorkerRunning();
  };
  tick();
  setInterval(tick, SUPERVISOR_INTERVAL_MS).unref?.();
}
