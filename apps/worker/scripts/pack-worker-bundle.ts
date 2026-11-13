/**
 * pack-worker-bundle.ts (Task 3.8-P) — đóng gói source worker + phụ thuộc thành ZIP
 * để client (worker sandbox mới) tải về boot, KHÔNG cần clone repo.
 *
 * Chạy: `bun apps/worker/scripts/pack-worker-bundle.ts` (từ đâu cũng được)
 * Output (apps/worker/dist/ — gitignored):
 *   - worker-bundle-<version>-<gitsha>.zip   (versioned)
 *   - worker-bundle.zip + .sha256            (fixed name — CI upload lên Release rolling)
 *   - MANIFEST.txt (version, sha, file list)
 *
 * Nội dung zip (extract ra thư mục `zaiwebhub-worker/`):
 *   package.json + tsconfig.base.json + bun.lock + README.md   (root workspace — `bun install` được ngay)
 *   apps/worker/**  (Next.js worker: UI :3000 + instrumentation boot WS)
 *   packages/protocol/** + packages/zai-adapter/**             (phụ thuộc workspace)
 *   docs/deploy/20-worker-sandbox.md                           (runbook gốc)
 *   START-HERE.md + .env.example                               (generated — hướng dẫn boot)
 *
 * An toàn: CẤM đưa node_modules/.next/log/.worker-config.json/.env vào zip;
 * scan toàn bộ file text staged — nếu thấy `WORKER_SECRET=<giá trị thật>` → ABORT.
 * Placeholder dạng `<WORKER_SECRET>` / rỗng là hợp lệ.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';

/* ---------- helpers ---------- */

function sh(cmd: string, opts?: { cwd?: string }): string {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function die(msg: string): never {
  console.error(`[pack-worker] FATAL: ${msg}`);
  process.exit(1);
}

const EXCLUDE_NAMES = new Set([
  'node_modules',
  '.next',
  'dist',
  '.turbo',
  '.DS_Store',
  'tsconfig.tsbuildinfo',
  '.worker-config.json',
]);
const EXCLUDE_SUFFIXES = ['.log', '.zip', '.tsbuildinfo'];

function excluded(relPath: string): boolean {
  const parts = relPath.split('/');
  if (parts.some((p) => EXCLUDE_NAMES.has(p))) return true;
  const base = parts[parts.length - 1];
  if (base.startsWith('.env') && base !== '.env.example') return true;
  return EXCLUDE_SUFFIXES.some((s) => base.endsWith(s));
}

function walk(dir: string, rootDir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(rootDir, abs).replaceAll('\\', '/');
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (!excluded(rel)) walk(abs, rootDir, out);
    } else if (!excluded(rel)) {
      out.push(rel);
    }
  }
}

const TEXT_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '',
]);

function extOf(rel: string): string {
  const i = rel.lastIndexOf('.');
  return i === -1 ? '' : rel.slice(i);
}

/** scan giá trị secret thật — placeholder `<…>` hoặc rỗng là OK. */
function scanForRealSecrets(files: { rel: string; abs: string }[]): void {
  const offenders: string[] = [];
  for (const f of files) {
    if (!TEXT_EXT.has(extOf(f.rel))) continue;
    const st = statSync(f.abs);
    if (st.size > 512 * 1024) continue;
    const text = readFileSync(f.abs, 'utf8');
    // WORKER_SECRET=abcd1234…  /  "WORKER_SECRET": "abcd1234…" — value thật dài ≥24 (placeholder <…> không khớp char class)
    const re = /WORKER_SECRET["']?\s*[:=]\s*["']?([A-Za-z0-9_\-]{24,})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[1] && !m[1].includes('<')) offenders.push(`${f.rel} → WORKER_SECRET=${m[1].slice(0, 6)}…`);
    }
  }
  if (offenders.length > 0) {
    die(`phát hiện giá trị WORKER_SECRET thật trong file staged — ABORT (không đóng gói):\n  ${offenders.join('\n  ')}`);
  }
}

/* ---------- START-HERE.md + .env.example (generated, khổng gói từ disk) ---------- */

const START_HERE = `# START-HERE — boot worker sandbox từ bundle này

Bundle chứa SOURCE worker (apps/worker) + 2 package phụ thuộc (packages/protocol,
packages/zai-adapter) + root workspace config. Kế hoạch chi tiết đầy đủ:
\`docs/deploy/20-worker-sandbox.md\` (kèm trong bundle).

## 0. Yêu cầu
- Sandbox/container có **bun** (\`bun --version\`) + outbound internet OK.
- Lấy từ Hub UI (console :3000 của sandbox hub → tab **Workers**):
  1. **HUB PUBLIC BASE URL** (vd \`https://<hub-host>\`)
  2. **WORKER_SECRET** (box WORKER_SECRET — bấm Hiện rồi Copy)

## 1. Cài đặt
\`\`\`bash
bun install          # chạy ở ROOT của thư mục đã extract (zaiwebhub-worker/)
\`\`\`

## 2. Boot — 2 cách

### Cách A — UI setup (khuyến nghị lần đầu)
\`\`\`bash
( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )   # chạy trong apps/worker/
\`\`\`
Mở :3000 của sandbox này → form setup → paste URL + secret → Connect → Start runtime.

### Cách B — headless qua env (không cần mở UI)
\`\`\`bash
export HUB_URL='https://<hub-host>'        # public URL sandbox hub
export WORKER_SECRET='<WORKER_SECRET>'     # từ Hub UI
export WORKER_ID='w-<tên-sandbox>'         # DUY NHẤT cho mỗi sandbox
( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )   # chạy trong apps/worker/
\`\`\`

> Pattern launch bắt buộc: subshell-orphan \`( nohup … & )\` — KHÔNG dùng \`setsid\`/\`disown\`.
> Port strict 3000 (đổi: \`WORKER_PORT=<port>\`) — bận thì FATAL, KHÔNG tự đổi port.

## 3. Kiểm tra boot thành công
- \`worker.log\` có \`worker.register sent\` → \`registered\`.
- Hub log có \`worker registered\` với WORKER_ID của bạn.
- Hub UI tab **Workers** (poll 5s) hiện badge **online** + inflight/total_jobs.
- Chat thử: Hub UI tab **Console** → mode WebHub (E2E) → gửi 1 prompt → stream trả lời,
  đúng 1 \`[DONE]\`.

## 4. Sự cố nhanh
| Triệu chứng | Xử lý |
|---|---|
| \`FATAL: port 3000 ĐÃ BẬN\` | \`ss -ltnp | grep :3000\` → kill tiến trình chiếm port → launch lại |
| \`worker-token 401\` lặp | Sai WORKER_SECRET → paste lại từ Hub UI |
| \`duplicate worker_id\` | 2 process cùng ID → kill hết rồi start 1 instance |
| Worker chết sau vài phút | Sai launch pattern → dùng đúng \`( nohup … & )\` |
`;

const ENV_EXAMPLE = `# apps/worker — env example (3.8-P). Copy thành .env.local hoặc export trực tiếp.
# 3 biến đầu là BẮT BUỘC cho headless mode (env ưu tiên hơn .worker-config.json khi boot).

HUB_URL=https://<hub-host>
WORKER_SECRET=
WORKER_ID=w-<ten-sandbox>

# --- tuỳ chọn ---
# HUB_TOKEN_URL=            # mặc định derive từ HUB_URL (giữ nguyên query gateway XTransformPort)
# TENANT_ID=default
# WORKER_CONCURRENCY=2
# WORKER_PORT=3000          # strict port — bận thì FATAL, không tự đổi
# MODE=direct               # 'relay' chỉ khi sandbox không ra được outbound tới hub
`;

/* ---------- main ---------- */

function main(): void {
  const scriptDir = import.meta.dir; // apps/worker/scripts
  const workerDir = resolve(scriptDir, '..');
  const repoRoot = resolve(workerDir, '..', '..');
  const distDir = join(workerDir, 'dist');
  const stageDir = join(distDir, `.stage-${Date.now()}`);
  const bundleRootName = 'zaiwebhub-worker';

  const pkg = JSON.parse(readFileSync(join(workerDir, 'package.json'), 'utf8')) as {
    version?: string;
  };
  const version = pkg.version ?? '0.0.0';
  let gitSha = 'nogit';
  try {
    gitSha = sh('git rev-parse --short HEAD', { cwd: repoRoot });
  } catch {
    // không phải git checkout — vẫn đóng gói được
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const zipName = `worker-bundle-${version}-${gitSha}.zip`;

  // ---- thu thập file ----
  const files: { rel: string; abs: string }[] = [];
  const addRootFile = (name: string) => {
    const abs = join(repoRoot, name);
    if (existsSync(abs)) files.push({ rel: name, abs });
    else console.warn(`[pack-worker] cảnh báo: thiếu ${name} ở root — bỏ qua`);
  };
  addRootFile('package.json');
  addRootFile('tsconfig.base.json');
  addRootFile('bun.lock');
  addRootFile('README.md');

  const collected: string[] = [];
  walk(join(repoRoot, 'packages', 'protocol'), repoRoot, collected);
  walk(join(repoRoot, 'packages', 'zai-adapter'), repoRoot, collected);
  walk(workerDir, repoRoot, collected); // rel tính theo repoRoot → giữ prefix apps/worker/ trong zip
  for (const rel of collected) {
    files.push({ rel, abs: join(repoRoot, rel) });
  }
  // runbook gốc
  const runbook = join(repoRoot, 'docs', 'deploy', '20-worker-sandbox.md');
  if (existsSync(runbook)) files.push({ rel: 'docs/deploy/20-worker-sandbox.md', abs: runbook });

  // dedupe + sort
  const seen = new Set<string>();
  const uniq = files.filter((f) => (seen.has(f.rel) ? false : (seen.add(f.rel), true)));
  uniq.sort((a, b) => a.rel.localeCompare(b.rel));

  // ---- safety: cấm pattern + scan secret ----
  const forbidden = uniq.filter((f) => excluded(f.rel));
  if (forbidden.length > 0) {
    die(`file cấm lọt vào bundle: ${forbidden.map((f) => f.rel).join(', ')}`);
  }
  scanForRealSecrets(uniq);
  const workerConfigLeak = uniq.find((f) => f.rel.endsWith('.worker-config.json'));
  if (workerConfigLeak) die(`.worker-config.json lọt vào bundle: ${workerConfigLeak.rel}`);

  // ---- staging ----
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  const bundleRoot = join(stageDir, bundleRootName);
  let totalBytes = 0;
  for (const f of uniq) {
    const dest = join(bundleRoot, f.rel);
    mkdirSync(dest.slice(0, dest.lastIndexOf('/')), { recursive: true });
    cpSync(f.abs, dest);
    totalBytes += statSync(f.abs).size;
  }
  writeFileSync(join(bundleRoot, 'START-HERE.md'), START_HERE);
  writeFileSync(join(bundleRoot, 'apps', 'worker', '.env.example'), ENV_EXAMPLE);
  totalBytes += Buffer.byteLength(START_HERE) + Buffer.byteLength(ENV_EXAMPLE);

  // ---- zip ----
  mkdirSync(distDir, { recursive: true });
  sh(`cd ${JSON.stringify(stageDir)} && zip -q -r ${JSON.stringify(join(distDir, zipName))} ${bundleRootName}`);
  const versionedZip = join(distDir, zipName);
  const fixedZip = join(distDir, 'worker-bundle.zip');
  cpSync(versionedZip, fixedZip);
  const zipBytes = statSync(versionedZip).size;
  const sha = createHash('sha256').update(readFileSync(versionedZip)).digest('hex');
  writeFileSync(`${fixedZip}.sha256`, `${sha}  worker-bundle.zip\n`);
  writeFileSync(`${versionedZip}.sha256`, `${sha}  ${zipName}\n`);

  // ---- manifest ----
  const manifest = [
    `# worker-bundle MANIFEST (3.8-P)`,
    `version:      ${version}`,
    `git_sha:      ${gitSha}`,
    `built_at:     ${new Date().toISOString()}`,
    `zip:          ${zipName}`,
    `zip_bytes:    ${zipBytes}`,
    `src_files:    ${uniq.length} (+START-HERE.md +.env.example)`,
    `src_bytes:    ${totalBytes}`,
    `sha256:       ${sha}`,
    ``,
    `# file list:`,
    ...uniq.map((f) => f.rel),
    'START-HERE.md',
    'apps/worker/.env.example',
  ].join('\n');
  writeFileSync(join(distDir, 'MANIFEST.txt'), manifest + '\n');

  // ---- cleanup staging ----
  rmSync(stageDir, { recursive: true, force: true });

  console.log(
    `[pack-worker] OK: ${zipName} (${(zipBytes / 1024).toFixed(0)} KB, ${uniq.length + 2} files, sha256=${sha.slice(0, 12)}…)`,
  );
  console.log(`[pack-worker] dist: ${versionedZip}`);
  console.log(`[pack-worker] dist: ${fixedZip} (+ .sha256, MANIFEST.txt)`);
}

main();
