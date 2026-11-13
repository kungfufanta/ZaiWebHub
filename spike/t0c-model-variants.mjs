// spike-t0c-variants.mjs — thử các biến thể model/thinking để tìm reasoning_content thật
import ZAI from 'z-ai-web-dev-sdk';

const t0 = Date.now();
const watchdog = setTimeout(() => { console.error('WATCHDOG'); process.exit(3); }, 180000);

const trunc = (s, n = 90) => { const len = s.length; return len > n ? s.slice(0, n) + `…(len ${len})` : s; };

const zai = await ZAI.create();

const VARIANTS = [
  { label: 'no-model + thinking', body: { stream: true, thinking: { type: 'enabled' } } },
  { label: 'glm-4.6 + thinking', body: { model: 'glm-4.6', stream: true, thinking: { type: 'enabled' } } },
  { label: 'glm-4.5 + thinking', body: { model: 'glm-4.5', stream: true, thinking: { type: 'enabled' } } },
];

async function runVariant(v) {
  const res = { label: v.label, ok: false, model: null, reasoningCount: 0, contentCount: 0, finish: null, reasoningSample: null, error: null, ms: 0 };
  const s0 = Date.now();
  try {
    const upstream = await zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Một câu hỏi cần suy luận: 15 + 27 * 2 bằng bao nhiêu? Giải thích ngắn.' }],
      ...v.body,
    });
    if (typeof upstream?.getReader !== 'function') { res.error = 'not a ReadableStream'; res.ms = Date.now() - s0; return res; }
    const reader = upstream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, idx); buffer = buffer.slice(idx + 2);
        for (const raw of block.split('\n')) {
          const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          let parsed; try { parsed = JSON.parse(data); } catch { continue; }
          if (!res.model && parsed.model) res.model = parsed.model;
          const choice = parsed.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? choice.message ?? {};
          if (delta?.reasoning_content) {
            res.reasoningCount++;
            if (!res.reasoningSample) res.reasoningSample = { keysTop: Object.keys(parsed), deltaKeys: Object.keys(delta), preview: trunc(delta.reasoning_content) };
          }
          if (delta?.content) res.contentCount++;
          if (choice.finish_reason && !res.finish) res.finish = { reason: choice.finish_reason, hasUsage: !!parsed.usage };
        }
      }
    }
    try { await reader.cancel(); } catch {}
    res.ok = true;
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
  }
  res.ms = Date.now() - s0;
  return res;
}

const out = [];
for (const v of VARIANTS) {
  const r = await runVariant(v);
  out.push(r);
  console.log(JSON.stringify(r));
}
clearTimeout(watchdog);
console.log('ALL_VARIANTS_DONE in ' + (Date.now() - t0) + 'ms');
process.exit(0);
