// mini-services/worker — src/runtime-paths.ts (4.4-Q)
// Deploy-aware path resolution cho file cấu hình worker (worker-config.json).
// Bản sao đồng bộ của src/lib/runtime-paths.ts (console) và
// mini-services/hub/src/runtime-paths.ts (hub) — 3 bundle độc lập nên giữ 3 bản.
//
// Vì sao cần: worker chạy ở 2 ngữ cảnh:
//  1. sandbox dev/source : bun --hot index.ts (cwd = mini-services/worker)
//     → worker-config.json nằm cạnh index.ts (join(import.meta.dir,'..') cũ vẫn đúng).
//  2. FC deploy prod     : bundle /app/mini-services-dist/mini-service-worker.js
//     → import.meta.dir = /app/mini-services-dist → join('..') cũ = /app — vẫn "trúng"
//     nhưng vô tình; console (4.4-Q) cũng ghi worker-config.json vào cùng chỗ khi sync
//     secret sau rotate. Nay chuẩn hoá qua 1 thuật toán duy nhất + env override.
//
//   1) WORKER_CONFIG_FILE — override trực tiếp đường dẫn file (cao nhất)
//   2) WEBHUB_RUNTIME_DIR / WEBHUB_ROOT — override thư mục runtime/root
//   3) walk-up từ cwd và import.meta.dir: dir có .runtime tồn tại → marker repo
//      (mini-services/hub/index.ts) → marker prod (mini-services-dist | start.sh | db/custom.db)
//   4) fallback cwd
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface DeployRoot {
  root: string;
  /** true = layout FC deploy (/app có mini-services-dist), false = layout repo. */
  prodLayout: boolean;
}

const REPO_MARKER = ['mini-services', 'hub', 'index.ts'];
// 4.4-Qa: marker đủ mạnh — loại 'db/custom.db' (Next standalone trace có thể copy theo).
const PROD_MARKERS: string[][] = [['mini-services-dist'], ['start.sh']];

function looksProd(dir: string): boolean {
  return PROD_MARKERS.some((m) => existsSync(join(dir, ...m)));
}

/**
 * 4.4-Qa — LUẬT LOẠI BỎ: Next standalone dist (server.js + .next cùng cấp) bị tracer
 * copy cả mini-services/hub/index.ts vào theo → không bao giờ được coi là root hợp lệ.
 */
function isNextStandaloneDist(dir: string): boolean {
  return existsSync(join(dir, 'server.js')) && existsSync(join(dir, '.next'));
}

function walkUp(start: string): DeployRoot | null {
  let cur = start;
  for (let depth = 0; depth < 8; depth++) {
    if (!isNextStandaloneDist(cur)) {
      if (existsSync(join(cur, '.runtime'))) return { root: cur, prodLayout: looksProd(cur) };
      if (existsSync(join(cur, ...REPO_MARKER))) return { root: cur, prodLayout: false };
      if (looksProd(cur)) return { root: cur, prodLayout: true };
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

export function findDeployRoot(): DeployRoot {
  const envRoot = process.env.WEBHUB_ROOT?.trim();
  if (envRoot) return { root: envRoot, prodLayout: looksProd(envRoot) };
  const starts: string[] = [];
  if (process.cwd()) starts.push(process.cwd());
  try {
    const d = import.meta.dir;
    if (d && !starts.includes(d)) starts.push(d);
  } catch {
    /* import.meta không khả dụng → bỏ qua */
  }
  for (const start of starts) {
    const hit = walkUp(start);
    if (hit) return hit;
  }
  return { root: process.cwd(), prodLayout: false };
}

export function runtimeDir(): string {
  const envDir = process.env.WEBHUB_RUNTIME_DIR?.trim();
  if (envDir) return envDir;
  return join(findDeployRoot().root, '.runtime');
}

/**
 * Đường dẫn worker-config.json — khớp với console (sync secret sau rotate):
 *  - sandbox layout : <root>/mini-services/worker/worker-config.json
 *  - FC deploy      : <root>/worker-config.json (bundle nằm /app/mini-services-dist,
 *                     file config nằm cạnh start.sh cho dễ soi log)
 */
export function workerConfigFile(): string {
  const envFile = process.env.WORKER_CONFIG_FILE?.trim();
  if (envFile) return envFile;
  const { root, prodLayout } = findDeployRoot();
  return prodLayout
    ? join(root, 'worker-config.json')
    : join(root, 'mini-services', 'worker', 'worker-config.json');
}
