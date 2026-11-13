// spike-t0c.mjs — T0-c v2: dump shape THẬT của zsdk stream (glm-5.3, thinking enabled)
// Phát hiện: zsdk 0.0.18 trả ReadableStream<Uint8Array> raw SSE — KHÔNG phải AsyncIterable objects.
// Script này parse SSE như prototype route.ts làm, rồi ghi lại shape chunk đã parse.
import ZAI from 'z-ai-web-dev-sdk';

const t0 = Date.now();
const watchdog = setTimeout(() => { console.error('WATCHDOG: 120s — aborting'); process.exit(3); }, 120000);

const trunc = (s, n = 100) => { const len = s.length; return len > n ? s.slice(0, n) + `…(truncated, total ${len} chars)` : s; };
function sample(parsed) {
  const clone = JSON.parse(JSON.stringify(parsed));
  for (const c of clone.choices ?? []) {
    const d = c.delta ?? c.message ?? {};
    for (const k of ['content', 'reasoning_content', 'role']) {
      if (typeof d[k] === 'string') d[k] = trunc(d[k]);
    }
  }
  return clone;
}

const zai = await ZAI.create();
const upstream = await zai.chat.completions.create({
  model: 'glm-5.3',
  stream: true,
  thinking: { type: 'enabled' },
  messages: [{ role: 'user', content: 'Nêu 3 lý do ngắn gọn vì sao bầu trời có màu xanh, mỗi lý do 1 câu.' }],
});

const shape =
  typeof upstream?.getReader === 'function' ? 'ReadableStream<Uint8Array> (raw SSE bytes)' :
  upstream?.[Symbol.asyncIterator] ? 'AsyncIterable' : 'plain object';

const cap = {
  sseBlocks: 0, dataLines: 0, commentLines: 0, otherLines: 0,
  parsedChunks: 0, reasoningCount: 0, contentCount: 0, sawDone: false,
  firstRawPreview: null, first: null, reasoning: [], content: [], finish: null, lastRaw: null,
};

if (typeof upstream?.getReader === 'function') {
  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  outer:
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    buffer += text;
    if (!cap.firstRawPreview) cap.firstRawPreview = trunc(buffer.replace(/\n/g, '\\n'), 200);
    cap.lastRaw = trunc(text.replace(/\n/g, '\\n'), 120);
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      cap.sseBlocks++;
      for (const rawLine of block.split('\n')) {
        const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
        if (!line.startsWith('data:')) {
          if (line.trim().length > 0 && !line.startsWith(':')) cap.otherLines++;
          if (line.startsWith(':')) cap.commentLines++;
          continue;
        }
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === '[DONE]') { cap.sawDone = true; break outer; }
        cap.dataLines++;
        let parsed;
        try { parsed = JSON.parse(data); } catch { continue; }
        cap.parsedChunks++;
        const ms = Date.now() - t0;
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? choice.message ?? {};
        if (!cap.first) cap.first = { atMs: ms, chunk: sample(parsed) };
        if (delta?.reasoning_content) {
          cap.reasoningCount++;
          if (cap.reasoning.length < 2) cap.reasoning.push({ atMs: ms, chunk: sample(parsed) });
        }
        if (delta?.content) {
          cap.contentCount++;
          if (cap.content.length < 2) cap.content.push({ atMs: ms, chunk: sample(parsed) });
        }
        if (choice.finish_reason && !cap.finish) cap.finish = { atMs: ms, reason: choice.finish_reason, chunk: sample(parsed) };
        if (cap.first && cap.reasoning.length >= 2 && cap.content.length >= 2 && cap.finish) break outer;
      }
    }
  }
  try { await reader.cancel(); } catch {}
} else {
  console.error('UPSTREAM KHÔNG PHẢI ReadableStream — shape: ' + shape);
  console.log(JSON.stringify({ shape, upstream: JSON.parse(JSON.stringify(upstream)) }, null, 2));
  process.exit(2);
}

clearTimeout(watchdog);
console.log(JSON.stringify({
  shape,
  rawWirePreview: cap.firstRawPreview,
  lastRawRead: cap.lastRaw,
  sseBlocks: cap.sseBlocks,
  dataLines: cap.dataLines,
  commentKeepAliveLines: cap.commentLines,
  otherLines: cap.otherLines,
  parsedChunks: cap.parsedChunks,
  reasoningChunkCount: cap.reasoningCount,
  contentChunkCount: cap.contentCount,
  sawDoneSentinel: cap.sawDone,
  firstParsedChunk: cap.first,
  reasoningSamples: cap.reasoning,
  contentSamples: cap.content,
  finish: cap.finish,
  totalMs: Date.now() - t0,
}, null, 2));
process.exit(0);
