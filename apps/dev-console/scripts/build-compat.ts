/**
 * build-compat.ts — TEMPORARY compat layer (Đợt 3, agent 3-c).
 *
 * Vấn đề: packages/protocol + packages/zai-adapter ship RAW TypeScript source với
 * import kiểu NodeNext (`./frames.js`), không có dist. tsc hiểu (substitution .js→.ts),
 * NHƯNG Turbopack áp `fullySpecified` cho package ESM ("type":"module") nên không map
 * được `./frames.js` → `frames.ts` khi bundle; Node native-TS cũng không map. Kết quả:
 * bất kỳ runtime nào load package qua specifier đều chết "Can't resolve './frames.js'".
 * packages/ nằm NGOÀI phạm vi dev-console (không được sửa) → compat build ở đây:
 * bundle 2 package thành JS thuần (bun resolver tự map .js→.ts) vào `.zai-compat/`,
 * rồi next.config.ts alias specifier sang bản bundle đó.
 *
 * Bỏ lớp này khi packages/ tự ship dist (build step) hoặc đổi style import
 * (flag cho owner + agent 3-a — lỗi này cũng sẽ chặn apps/worker khi T2-b chạy).
 *
 * Chạy tự động trước `next dev` (script "dev" trong package.json):
 *   bun run scripts/build-compat.ts
 */
import { $ } from 'bun';

const OUT_PROTOCOL = '.zai-compat/protocol';
const OUT_ADAPTER = '.zai-compat/adapter';

async function bundle(entrypoint: string, outdir: string, externals: string[]): Promise<string> {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir,
    format: 'esm',
    target: 'node',
    // bun resolver tự map './x.js' → 'x.ts' (NodeNext) khi bundle — lý do chính của compat này.
    external: externals,
    naming: '[name].js',
    sourcemap: 'none',
    minify: false,
  });
  if (!result.success) {
    console.error(`[build-compat] FAILED for ${entrypoint}`);
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
  // import() của Bun resolve tương đối với FILE gọi (scripts/) — dùng URL tuyệt đối cho chắc.
  const url = new URL(`../${outdir}/index.js`, import.meta.url);
  return url.href;
}

async function assertExport(fileUrl: string, name: string): Promise<void> {
  const mod = (await import(fileUrl)) as Record<string, unknown>;
  if (typeof mod[name] !== 'function') {
    console.error(`[build-compat] ${fileUrl} missing export "${name}" — packages API drift?`);
    process.exit(1);
  }
}

// 1) protocol (zod bundled — không có node_modules up-chain chứa zod cho .zai-compat)
const protocolFile = await bundle('../../packages/protocol/src/index.ts', OUT_PROTOCOL, []);
await assertExport(protocolFile, 'buildSseErrorFrame');
await assertExport(protocolFile, 'createSseMetadataScanner');

// 2) adapter (bundle trọn: protocol + zod + zsdk inline; KHÔNG external gì để compat file self-contained)
const adapterFile = await bundle('../../packages/zai-adapter/src/index.ts', OUT_ADAPTER, []);
await assertExport(adapterFile, 'streamChat');

// marker để Node/Turbopack coi output là ESM thuần
await Bun.write(`${OUT_PROTOCOL}/package.json`, '{"type":"module"}\n');
await Bun.write(`${OUT_ADAPTER}/package.json`, '{"type":"module"}\n');

console.log('[build-compat] OK: .zai-compat/protocol/index.js + .zai-compat/adapter/index.js');
