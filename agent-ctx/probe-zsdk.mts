// agent-ctx/probe-zsdk.ts — probe trực tiếp zsdk (không qua adapter) để cô lập chỗ hang.
// Chỉ in metadata/đếm — KHÔNG in nội dung message/reasoning.
const t0 = Date.now();
const stamp = (): string => `${Date.now() - t0}ms`;

console.log(`[${stamp()}] importing zsdk...`);
const mod = await import('z-ai-web-dev-sdk');
console.log(`[${stamp()}] imported, default type: ${typeof mod.default}`);
const ZAI = mod.default as unknown as { create: () => Promise<any> };
console.log(`[${stamp()}] calling ZAI.create()...`);
const zai = await ZAI.create();
console.log(`[${stamp()}] client created`);

console.log(`[${stamp()}] calling chat.completions.create(stream:true)...`);
const body = (await zai.chat.completions.create({
  stream: true,
  model: 'glm-5.3',
  messages: [{ role: 'user', content: 'Nói ngắn gọn: 1+1=?' }],
  thinking: { type: 'enabled' },
})) as unknown;
console.log(`[${stamp()}] create() resolved; has getReader: ${typeof (body as any)?.getReader === 'function'}`);

if (typeof (body as any)?.getReader === 'function') {
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  let n = 0;
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += 1;
    bytes += value.byteLength;
    if (n === 1) console.log(`[${stamp()}] FIRST CHUNK (${value.byteLength}B)`);
  }
  console.log(`[${stamp()}] stream done: chunks=${n} bytes=${bytes}`);
}
process.exit(0);
