// src/lib/runtime-paths.ts (4.4-Q — deploy-aware runtime paths)
// Resolve thư mục runtime (.runtime/…) cho CONSOLE sao cho khớp với hub/worker trong
// MỌI ngữ cảnh chạy. Trước 4.4-Q console dùng process.cwd() trực tiếp:
//  - sandbox dev        : cwd = root → đúng.
//  - FC deploy prod     : server.js standalone chạy với cwd = /app/next-service-dist
//    → console ghi secret vào /app/next-service-dist/.runtime/, trong khi hub bundle
//    (walk-up cũ) đọc /.runtime/ → owner tạo secret trên web nhưng worker vẫn 401
//    → "deploy lên sóng mà worker không bao giờ đăng ký được" (chết thầm lặng).
//
// Quy tắc (PHẢI đồng bộ y hệt với mini-services/hub/src/runtime-paths.ts và
// mini-services/worker/src/runtime-paths.ts — 3 bản sao vì 3 bundle độc lập):
//   1) WEBHUB_RUNTIME_DIR  — override trực tiếp thư mục .runtime (cao nhất)
//   2) WEBHUB_ROOT         — override root repo/deploy
//   3) walk-up từ cwd (tối đa 8 cấp):
//        a. dir có .runtime ĐANG TỒN TẠI → dùng luôn (mọi process đi qua cùng
//          ancestor chain → chạm cùng root → cùng .runtime)
//        b. dir có marker repo  (mini-services/hub/index.ts) → sandbox/dev layout
//        c. dir có marker prod  (mini-services-dist | start.sh | db/custom.db) → FC deploy layout
//   4) fallback: cwd
//
// KHÔNG dùng import.meta.dir ở file này: Next server bundle có thể là CJS
// (import.meta là SyntaxError trong CJS) — cwd của server Next luôn đáng tin
// (dev = root, standalone prod = next-service-dist hay .next/standalone).
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface DeployRoot {
  root: string;
  /** true = layout FC deploy (/app có mini-services-dist), false = layout repo. */
  prodLayout: boolean;
}

const REPO_MARKER = ['mini-services', 'hub', 'index.ts'];
// 4.4-Qa: marker phải ĐỦ MẠNH — 'db/custom.db' bị loại vì Next standalone trace có thể
// copy nó vào next-service-dist (marker giả). start.sh/minl-services-dist CHỈ tồn tại
// ở root deploy của platform, không bao giờ nằm trong next-service-dist.
const PROD_MARKERS: string[][] = [['mini-services-dist'], ['start.sh']];

function looksProd(dir: string): boolean {
  return PROD_MARKERS.some((m) => existsSync(join(dir, ...m)));
}

/**
 * 4.4-Qa — LUẬT LOẠI BỎ quan trọng: Next standalone dist (next-service-dist hay
 * .next/standalone) bị file-tracer copy cả mini-services/hub/index.ts + src/lib vào theo
 * (do các join path literal trong worker-secret-store/hub-supervisor) → nếu không loại
 * thì walk-up sẽ nhầm THƯ MỤC NÀY là repo root → console ghi .runtime cạnh server.js
 * trong khi hub bundle (cwd=/app) đọc ở root deploy → secret ghi từ web không bao giờ
 * đến tay hub. Dấu hiệu standalone dist: server.js + .next cùng cấp.
 */
function isNextStandaloneDist(dir: string): boolean {
  return existsSync(join(dir, 'server.js')) && existsSync(join(dir, '.next'));
}

function walkUp(start: string): DeployRoot | null {
  let cur = start;
  for (let depth = 0; depth < 8; depth++) {
    if (!isNextStandaloneDist(cur)) {
      // (a) .runtime đang tồn tại — dùng luôn
      if (existsSync(join(cur, '.runtime'))) return { root: cur, prodLayout: looksProd(cur) };
      // (b) marker repo (sandbox/dev)
      if (existsSync(join(cur, ...REPO_MARKER))) return { root: cur, prodLayout: false };
      // (c) marker prod (FC deploy)
      if (looksProd(cur)) return { root: cur, prodLayout: true };
    }
    const parent = dirname(cur);
    if (parent === cur) break; // chạm gốc filesystem
    cur = parent;
  }
  return null;
}

export function findDeployRoot(): DeployRoot {
  const envRoot = process.env.WEBHUB_ROOT?.trim();
  if (envRoot) return { root: envRoot, prodLayout: looksProd(envRoot) };
  const hit = walkUp(process.cwd());
  return hit ?? { root: process.cwd(), prodLayout: false };
}

/** Thư mục chứa file runtime (worker-secret.json, api-keys.json). Tạo khi ghi. */
export function runtimeDir(): string {
  const envDir = process.env.WEBHUB_RUNTIME_DIR?.trim();
  if (envDir) return envDir;
  return join(findDeployRoot().root, '.runtime');
}

/** Đường dẫn worker-config.json của worker LOCAL — đúng cho cả sandbox lẫn FC deploy. */
export function localWorkerConfigFile(): string {
  const envFile = process.env.WORKER_CONFIG_FILE?.trim();
  if (envFile) return envFile;
  const { root, prodLayout } = findDeployRoot();
  return prodLayout
    ? join(root, 'worker-config.json') // bundle worker chạy cwd=/app, file nằm cạnh start.sh
    : join(root, 'mini-services', 'worker', 'worker-config.json');
}
