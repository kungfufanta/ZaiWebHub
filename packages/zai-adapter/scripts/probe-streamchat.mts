// probe2 — gọi streamChat() của adapter trực tiếp, log từng mốc thời gian để tìm chỗ hang.
import { streamChat } from '../src/index.ts';

const t0 = Date.now();
const stamp = (): string => `${Date.now() - t0}ms`;

process.on('unhandledRejection', (r) => {
  console.log(`[${stamp()}] UNHANDLED REJECTION:`, r);
});

console.log(`[${stamp()}] calling streamChat...`);
const stream = streamChat({
  messages: [{ role: 'user', content: 'Nói ngắn gọn: 1+1=?' }],
  model: 'glm-5.3',
  thinking: { type: 'enabled' },
});
console.log(`[${stamp()}] streamChat returned (sync)`);

const reader = stream.getReader();
console.log(`[${stamp()}] reader acquired; first read...`);

const abortTimer = setTimeout(() => {
  console.log(`[${stamp()}] FORCE ABORT after 20s hang`);
  // không có signal ở probe này — chỉ process.exit để thoát
  process.exit(2);
}, 20000);

let n = 0;
let bytes = 0;
for (;;) {
  const { done, value } = await reader.read();
  if (n === 0) console.log(`[${stamp()}] first read() resolved: done=${done}`);
  if (done) break;
  n += 1;
  bytes += value.byteLength;
  if (n <= 2) console.log(`[${stamp()}] chunk ${n}: ${value.byteLength}B`);
}
clearTimeout(abortTimer);
console.log(`[${stamp()}] stream closed: chunks=${n} bytes=${bytes}`);
process.exit(0);
