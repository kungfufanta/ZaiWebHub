// mini-services/hub — src/runtime-paths.ts (4.4-Q)
// Deploy-aware path resolution cho file runtime (.runtime/…) của HUB.
//
// 3 ngữ cảnh chạy của hub:
//  1. sandbox dev/source : bun --hot index.ts (cwd = mini-services/hub)
//     → repo root 2 cấp trên, .runtime nằm ở root.
//  2. FC deploy prod     : mini-services-build.sh bundle cả service thành MỘT file
//     /app/mini-services-dist/mini-service-hub.js — import.meta.dir lúc chạy =
//     /app/mini-services-dist (không còn cây src → hub → mini-services → root như
//     source) → walk-up 3 cấp cũ cho kết quả SAI (/.runtime) trong khi console ghi
//     vào /app/next-service-dist/.runtime → secret/key tạo từ web hub không bao giờ
//     đọc thấy → worker 401 vĩnh viễn ("deploy lên sóng mà worker chết thầm").
//  3. hosting tự quản    : set WEBHUB_ROOT (root) hoặc WEBHUB_RUNTIME_DIR (dir .runtime).
//
// Quy tắc (PHẢI đồng bộ y hệt với src/lib/runtime-paths.ts của console và
// mini-services/worker/src/runtime-paths.ts của worker — 3 bản sao vì 3 bundle độc lập):
//   1) WEBHUB_RUNTIME_DIR — override trực tiếp thư mục .runtime (cao nhất)
//   2) WEBHUB_ROOT — override root
//   3) walk-up từ cwd và import.meta.dir (tối đa 8 cấp), theo thứ tự mỗi cấp:
//        a. dir có .runtime ĐANG TỒN TẠI → dùng luôn
//        b. dir có marker repo (mini-services/hub/index.ts) → sandbox/dev layout
//        c. dir có marker prod (mini-services-dist | start.sh | db/custom.db) → FC layout
//   4) fallback cwd
// Mọi process (console/hub/worker) đi qua cùng chuỗi ancestor → chạm CÙNG root
// → cùng 1 thư mục .runtime trong mọi ngữ cảnh.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface DeployRoot {
  root: string;
  /** true = layout FC deploy (/app có mini-services-dist), false = layout repo. */
  prodLayout: boolean;
}

const REPO_MARKER = ['mini-services', 'hub', 'index.ts'];
// 4.4-Qa: marker phải ĐỦ MẠNH — 'db/custom.db' bị loại vì Next standalone trace có thể
// copy nó vào next-service-dist (marker giả).
const PROD_MARKERS: string[][] = [['mini-services-dist'], ['start.sh']];

function looksProd(dir: string): boolean {
  return PROD_MARKERS.some((m) => existsSync(join(dir, ...m)));
}

/**
 * 4.4-Qa — LUẬT LOẠI BỎ: Next standalone dist bị file-tracer copy cả mini-services/
 * hub/index.ts + src/lib vào theo (join path literal trong console code) → nếu không
 * loại, walk-up từ cwd=next-service-dist sẽ nhầm thư mục này là repo root. Dấu hiệu:
 * server.js + .next cùng cấp — không bao giờ là root hợp lệ.
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
  // 2 điểm xuất phát: cwd + import.meta.dir (thư mục file bundle) — cùng hội tụ về root.
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

/** Thư mục .runtime của hub — khớp với console (worker-secret.json, api-keys.json). */
export function runtimeDir(): string {
  const envDir = process.env.WEBHUB_RUNTIME_DIR?.trim();
  if (envDir) return envDir;
  return join(findDeployRoot().root, '.runtime');
}
