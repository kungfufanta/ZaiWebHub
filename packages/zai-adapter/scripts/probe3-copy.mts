// probe3 — bản copy CÓ LOG của thuật toán streamChat để tìm chính xác await bị hang.
const t0 = Date.now();
const stamp = (): string => `${Date.now() - t0}ms`;

process.on('unhandledRejection', (r) => {
  console.log(`[${stamp()}] UNHANDLED REJECTION:`, r);
});

console.log(`[${stamp()}] p1: dynamic import zsdk`);
const mod = await import('z-ai-web-dev-sdk');
console.log(`[${stamp()}] p2: imported`);
const ZAI = mod.default as unknown as { create: () => Promise<any> };
const client = await ZAI.create();
console.log(`[${stamp()}] p3: client created`);

// Copy thuật toán adapter (pull-based ReadableStream)
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let opened = false;
let closed = false;
let bytesEmitted = false;

const openUpstream = async (): Promise<void> => {
  if (opened || closed) return;
  opened = true;
  console.log(`[${stamp()}] p4: openUpstream entered`);
  try {
    console.log(`[${stamp()}] p5: calling create()`);
    const body: unknown = await client.chat.completions.create({
      stream: true,
      model: 'glm-5.3',
      messages: [{ role: 'user', content: 'Nói ngắn gọn: 1+1=?' }],
      thinking: { type: 'enabled' },
    });
    console.log(`[${stamp()}] p6: create resolved; isStream=${typeof (body as any)?.getReader === 'function'}`);
    if (closed) return;
    if (!body || typeof (body as any).getReader !== 'function') {
      console.log(`[${stamp()}] p6e: NON-SSE response → error frame path`);
      closed = true;
      return;
    }
    reader = (body as ReadableStream<Uint8Array>).getReader();
    console.log(`[${stamp()}] p7: reader set`);
  } catch (err) {
    console.log(`[${stamp()}] p6x: create threw:`, err instanceof Error ? err.message : err);
    closed = true;
  }
};

let pullCount = 0;
const stream = new ReadableStream<Uint8Array>({
  start(c) {
    console.log(`[${stamp()}] p3.5: start() entered`);
    void openUpstream();
    console.log(`[${stamp()}] p3.6: start() kicked openUpstream`);
  },
  async pull(c) {
    pullCount += 1;
    if (pullCount <= 3 || pullCount % 1000 === 0) {
      console.log(`[${stamp()}] pull #${pullCount} (reader=${!!reader})`);
    }
    if (closed) return;
    await openUpstream();
    if (closed || !reader) return;
    try {
      const { done, value } = await reader.read();
      if (closed) return;
      if (done) {
        closed = true;
        c.close();
        console.log(`[${stamp()}] pull: upstream done`);
        return;
      }
      bytesEmitted = true;
      c.enqueue(value);
    } catch (err) {
      console.log(`[${stamp()}] pull: read threw:`, err instanceof Error ? err.message : err);
      closed = true;
      try {
        c.close();
      } catch {
        /* noop */
      }
    }
  },
  cancel() {
    console.log(`[${stamp()}] cancel called`);
    closed = true;
  },
});
console.log(`[${stamp()}] p8: ReadableStream constructed`);

const r = stream.getReader();
console.log(`[${stamp()}] p9: reading...`);
let n = 0;
let bytes = 0;
for (;;) {
  const { done, value } = await r.read();
  if (n === 0) console.log(`[${stamp()}] p10: FIRST read resolved done=${done}`);
  if (done) break;
  n += 1;
  bytes += value.byteLength;
}
console.log(`[${stamp()}] p11: closed: chunks=${n} bytes=${bytes} pulls=${pullCount}`);
process.exit(0);
