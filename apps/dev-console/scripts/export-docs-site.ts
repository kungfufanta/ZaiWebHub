/**
 * export-docs-site.ts (3.7-D) — xuất tab /docs thành SITE STATIC self-contained
 * (1 file index.html duy nhất, inline CSS + JS) để deploy GitHub Pages.
 *
 * Chạy: `bun apps/dev-console/scripts/export-docs-site.ts` (từ repo root hoặc bất cứ đâu)
 * Output: apps/dev-console/docs-site/index.html
 *
 * Nguồn sự thật = src/lib/api-docs.ts (cùng dữ liệu với tab /docs của Hub UI).
 * Placeholder {HUB} trong code block: site static giữ nguyên ban đầu, có ô input
 * "HUB PUBLIC BASE URL" để người đọc tự điền (origin của GitHub Pages ≠ hub).
 *
 * KHÔNG cần bun install — module thuần, không dependency.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  API_DOCS,
  DOC_META,
  type DocBlock,
  type DocEndpoint,
  type HttpMethod,
} from '../src/lib/api-docs';

/* ---------- helpers ---------- */

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** inline `code` + **bold** — escape trước, parse sau. */
function inlineHTML(text: string): string {
  const escaped = esc(text);
  let out = '';
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(escaped)) !== null) {
    out += escaped.slice(last, m.index);
    if (m[1] !== undefined) out += `<code class="ic">${m[1]}</code>`;
    else out += `<strong>${m[2]}</strong>`;
    last = re.lastIndex;
  }
  out += escaped.slice(last);
  return out;
}

const METHOD_CLASS: Record<HttpMethod, string> = {
  GET: 'm-get',
  POST: 'm-post',
  SSE: 'm-sse',
  WS: 'm-ws',
};

/* ---------- block renderers ---------- */

let codeSeq = 0;
const CODE_ORIGS: Record<string, string> = {};

function renderBlock(b: DocBlock): string {
  switch (b.kind) {
    case 'p':
      return `<p class="dp">${inlineHTML(b.text)}</p>`;
    case 'list':
      return `<ul class="dul">${b.items.map((i) => `<li>${inlineHTML(i)}</li>`).join('')}</ul>`;
    case 'table':
      return `<div class="dtw"><table class="dt"><thead><tr>${b.headers
        .map((h) => `<th>${inlineHTML(h)}</th>`)
        .join('')}</tr></thead><tbody>${b.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, k) => `<td${k === 0 ? ' class="dt0"' : ''}>${inlineHTML(cell)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`;
    case 'note': {
      const cls = b.tone === 'info' ? 'note-info' : 'note-warn';
      const icon = b.tone === 'info' ? 'i' : '!';
      return `<div class="dnote ${cls}" role="note"><span class="nic" aria-hidden="true">${icon}</span><p>${inlineHTML(b.text)}</p></div>`;
    }
    case 'code': {
      const id = `code-${++codeSeq}`;
      CODE_ORIGS[id] = b.code;
      return `<figure class="cb"><figcaption class="cbh"><span class="cbt">${esc(
        b.title ?? '',
      )}</span><span class="cbr"><span class="cbl">${esc(b.lang)}</span><button type="button" class="copybtn" data-target="${id}" aria-label="Copy code">copy</button></span></figcaption><pre><code id="${id}">${esc(
        b.code,
      )}</code></pre></figure>`;
    }
    default:
      return '';
  }
}

function renderEndpoint(e: DocEndpoint): string {
  return `<article class="ep" id="${e.id}" aria-label="${esc(e.method)} ${esc(e.path)}">
  <div class="eph"><span class="mb ${METHOD_CLASS[e.method]}">${e.method}</span><code class="epp">${esc(
    e.path,
  )}</code><span class="eps">${esc(e.summary)}</span></div>
  <div class="epb">${e.blocks.map(renderBlock).join('\n')}</div>
</article>`;
}

function renderSection(s: (typeof API_DOCS)[number]): string {
  return `<section id="${s.id}" class="ds">
  <h2>${esc(s.title)}</h2>
  ${s.blurb ? `<p class="dblur">${esc(s.blurb)}</p>` : ''}
  ${s.blocks ? s.blocks.map(renderBlock).join('\n') : ''}
  ${s.endpoints?.map(renderEndpoint).join('\n') ?? ''}
</section>`;
}

/* ---------- sidebar + chips ---------- */

function sidebarHTML(): string {
  return API_DOCS.map((s) => {
    const subs = s.endpoints
      ?.map(
        (e) =>
          `<a class="ssub" href="#${e.id}"><span class="ssm ${METHOD_CLASS[e.method]}">${
            e.method
          }</span>${esc(e.path)}</a>`,
      )
      .join('\n');
    return `<a class="slink" href="#${s.id}">${esc(s.title)}</a>${subs ?? ''}`;
  }).join('\n');
}

function chipsHTML(): string {
  return API_DOCS.map(
    (s) => `<a class="chip" href="#${s.id}">${esc(s.title)}</a>`,
  ).join('\n');
}

/* ---------- CSS ---------- */

const CSS = `
:root{
  --bg:#ffffff;--fg:#18181b;--muted:#52525b;--faint:#a1a1aa;--border:#e4e4e7;
  --card:#ffffff;--card2:#fafafa;--accentbg:#f4f4f5;
  --codebg:#0f0f13;--codefg:#f4f4f5;--codehead:#18181b;--codeborder:#27272a;--codeMuted:#a1a1aa;
  --ic-bg:#f4f4f5;--ic-fg:#18181b;
  --green:#059669;--green-bg:#ecfdf5;--green-bd:#a7f3d0;
  --amber:#d97706;--amber-bg:#fffbeb;--amber-bd:#fde68a;
  --primary:#18181b;--primary-fg:#fafafa;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#09090b;--fg:#fafafa;--muted:#a1a1aa;--faint:#71717a;--border:#27272a;
    --card:#0c0c0f;--card2:#111113;--accentbg:#1c1c1f;
    --codebg:#0c0c0f;--codefg:#f4f4f5;--codehead:#18181b;--codeborder:#27272a;--codeMuted:#a1a1aa;
    --ic-bg:#27272a;--ic-fg:#fafafa;
    --green:#34d399;--green-bg:#06281e;--green-bd:#065f46;
    --amber:#fbbf24;--amber-bg:#2a1d05;--amber-bd:#92400e;
    --primary:#fafafa;--primary-fg:#18181b;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ic{background:var(--ic-bg);color:var(--ic-fg);border-radius:4px;padding:.1em .35em;font-size:.86em;word-break:break-word}
strong{font-weight:600}

/* header */
.top{position:sticky;top:0;z-index:40;background:var(--card);border-bottom:1px solid var(--border);backdrop-filter:blur(8px)}
.topin{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:9px 16px}
.logo{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;min-width:0}
.logodot{width:26px;height:26px;border-radius:8px;background:var(--primary);color:var(--primary-fg);display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0}
.badge{margin-left:auto;border:1px solid var(--border);border-radius:9999px;padding:2px 10px;font-family:ui-monospace,monospace;font-size:10px;color:var(--muted);white-space:nowrap}

/* layout */
.wrap{max-width:1120px;margin:0 auto;display:flex;gap:28px;padding:22px 16px 40px}
.sidebar{display:none}
@media(min-width:960px){.sidebar{display:block;width:230px;flex-shrink:0}.sidenav{position:sticky;top:58px;max-height:calc(100vh - 74px);overflow-y:auto;padding-bottom:12px}}
.content{flex:1;min-width:0}
.slbl{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:0 8px;margin:6px 0 2px}
.slink{display:block;border-radius:8px;padding:6px 8px;font-size:12.5px;font-weight:500;color:var(--muted)}
.slink:hover{background:var(--accentbg);color:var(--fg)}
.slink.active{background:var(--primary);color:var(--primary-fg)}
.ssub{display:flex;align-items:center;gap:6px;margin-left:14px;padding:3px 8px;font-size:10.5px;color:var(--faint);border-radius:6px;font-family:ui-monospace,monospace}
.ssub:hover{background:var(--accentbg);color:var(--fg)}

/* chips mobile */
.chips{display:flex;gap:6px;overflow-x:auto;padding:12px 16px 0}
@media(min-width:960px){.chips{display:none}}
.chip{flex-shrink:0;border:1px solid var(--border);background:var(--card);border-radius:9999px;padding:4px 12px;font-size:11.5px;color:var(--muted)}
.chip:hover{background:var(--accentbg);color:var(--fg)}
.chip.active{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}

/* base url box */
.bub{border:1px solid var(--border);background:var(--card2);border-radius:10px;padding:10px 12px;margin:0 0 18px;font-size:12.5px;color:var(--muted)}
.bub input{margin-left:6px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg);font-family:ui-monospace,monospace;font-size:12px;width:min(340px,60vw)}
.bub .bubv{color:var(--fg)}

/* sections */
.ds{margin:0 0 34px;scroll-margin-top:76px}
.ds h2{font-size:17px;font-weight:600;letter-spacing:-.01em;margin:0 0 6px}
.dblur{margin:0 0 12px;font-size:13px;color:var(--muted)}
.dp{margin:8px 0;font-size:13px;color:var(--muted)}
.dul{margin:8px 0;padding-left:18px}
.dul li{font-size:13px;color:var(--muted);margin:5px 0}
.dul li::marker{color:var(--faint)}

/* tables */
.dtw{overflow-x:auto;border:1px solid var(--border);border-radius:10px;margin:10px 0}
.dt{width:100%;border-collapse:collapse;font-size:12.5px;text-align:left}
.dt th{background:var(--card2);padding:8px 12px;font-weight:600;white-space:nowrap;border-bottom:1px solid var(--border)}
.dt td{padding:8px 12px;color:var(--muted);border-bottom:1px solid var(--border);vertical-align:top}
.dt tbody tr:last-child td{border-bottom:none}
.dt .dt0{white-space:nowrap;color:var(--fg);font-weight:500}

/* notes */
.dnote{display:flex;gap:10px;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12.5px}
.dnote p{margin:0}
.note-info{background:var(--green-bg);border:1px solid var(--green-bd);color:var(--green)}
.note-warn{background:var(--amber-bg);border:1px solid var(--amber-bd);color:var(--amber)}
.nic{flex-shrink:0;width:18px;height:18px;border-radius:9999px;border:1.5px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-top:2px}

/* endpoint card */
.ep{border:1px solid var(--border);border-radius:12px;background:var(--card);margin:14px 0;overflow:hidden;scroll-margin-top:76px}
.eph{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border)}
.epp{font-size:13px;font-weight:600;word-break:break-all}
.eps{flex-basis:100%;font-size:11.5px;color:var(--muted)}
@media(min-width:700px){.eps{flex-basis:auto;flex:1;text-align:right}}
.epb{padding:12px 14px}
.mb{display:inline-flex;border-radius:6px;padding:2px 8px;font-family:ui-monospace,monospace;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border:1px solid}
.m-get{color:var(--green);background:var(--green-bg);border-color:var(--green-bd)}
.m-post{color:var(--amber);background:var(--amber-bg);border-color:var(--amber-bd)}
.m-sse{color:#a855f7;background:#faf5ff;border-color:#e9d5ff}
.m-ws{color:#e11d48;background:#fff1f2;border-color:#fecdd3}
@media (prefers-color-scheme:dark){
  .m-sse{color:#c084fc;background:#241432;border-color:#581c87}
  .m-ws{color:#fb7185;background:#2b0d12;border-color:#9f1239}
}

/* code block */
.cb{margin:12px 0;border:1px solid var(--codeborder);border-radius:10px;background:var(--codebg);overflow:hidden}
.cbh{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 12px;background:var(--codehead);border-bottom:1px solid var(--codeborder)}
.cbt{font-size:11px;color:var(--codeMuted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cbr{display:flex;align-items:center;gap:8px;flex-shrink:0}
.cbl{background:#27272a;color:var(--codeMuted);border-radius:4px;padding:1px 6px;font-size:9.5px;text-transform:uppercase;font-family:ui-monospace,monospace}
.copybtn{background:transparent;border:1px solid #3f3f46;color:var(--codeMuted);border-radius:5px;font-size:10px;font-family:ui-monospace,monospace;padding:2px 8px;cursor:pointer}
.copybtn:hover{background:#27272a;color:var(--codefg)}
.copybtn.done{color:#34d399;border-color:#065f46}
.cb pre{margin:0;padding:12px;overflow:auto;max-height:560px}
.cb code{color:var(--codefg);font-size:11.5px;line-height:1.65;white-space:pre}

/* footer */
.foot{border-top:1px solid var(--border);background:var(--card);margin-top:auto}
.footin{max-width:1120px;margin:0 auto;padding:10px 16px;display:flex;flex-wrap:wrap;gap:4px 12px;justify-content:space-between;font-size:11.5px;color:var(--muted)}
.footin .mono{font-family:ui-monospace,monospace;font-size:10px;color:var(--faint)}

/* hints box cuối trang */
.dhint{border:1px dashed var(--border);border-radius:10px;padding:10px 12px;margin-top:8px;font-size:12.5px;color:var(--muted)}
.dhint .ic{margin:0 2px}
`;

/* ---------- JS ---------- */

// PHẢI là function (không phải const): gọi trong buildHTML() SAU khi render sections,
// để CODE_ORIGS đã được populate đầy đủ các code block.
function buildJS(): string {
  return `
(function(){
  // 1) {HUB} fill từ ô input
  var ORIGS = ${JSON.stringify(CODE_ORIGS).replaceAll('<', '\\u003c')};
  var input = document.getElementById('hub-base-input');
  function fill(){
    var base = (input && input.value ? input.value : '').replace(/\\/+$/,'');
    var shown = base || 'https://<hub-host>';
    Object.keys(ORIGS).forEach(function(k){
      var el = document.getElementById(k);
      if (el && ORIGS[k].indexOf('{HUB}') !== -1) el.textContent = ORIGS[k].replaceAll('{HUB}', shown);
    });
    var slots = document.querySelectorAll('.bubv');
    slots.forEach(function(s){ s.textContent = shown; });
  }
  if (input) input.addEventListener('input', fill);
  fill();

  // 2) copy buttons
  document.addEventListener('click', function(ev){
    var btn = ev.target.closest ? ev.target.closest('.copybtn') : null;
    if (!btn) return;
    var el = document.getElementById(btn.getAttribute('data-target'));
    if (!el) return;
    var text = el.textContent;
    function done(){ btn.classList.add('done'); btn.textContent='copied'; setTimeout(function(){ btn.classList.remove('done'); btn.textContent='copy'; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback(){
      var ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); done();
    }
  });

  // 3) scroll spy
  var links = Array.prototype.slice.call(document.querySelectorAll('.slink, .chip'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('.ds'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        if (!en.isIntersecting) return;
        var id = en.target.id;
        links.forEach(function(l){
          var on = l.getAttribute('href') === '#' + id;
          l.classList.toggle('active', on);
        });
      });
    }, { rootMargin: '-70px 0px -60% 0px', threshold: 0 });
    sections.forEach(function(s){ io.observe(s); });
  }
})();
`;
}

/* ---------- assemble ---------- */

function buildHTML(): string {
  const title = `${DOC_META.title} — ZaiWebHub`;
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(DOC_META.subtitle)}">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="topin">
    <a class="logo" href="#"><span class="logodot" aria-hidden="true">◇</span>ZaiWebHub — ${esc(
      DOC_META.title,
    )}</a>
    <span class="badge">${esc(DOC_META.badge)}</span>
  </div>
</header>
<nav class="chips" aria-label="Mục lục (mobile)">
${chipsHTML()}
</nav>
<div class="wrap">
  <aside class="sidebar" aria-label="Mục lục">
    <div class="sidenav">
      <p class="slbl">Mục lục</p>
${sidebarHTML()}
    </div>
  </aside>
  <main class="content">
    <div class="bub">
      Base URL hub qua gateway công cộng: <code class="bubv">https://&lt;hub-host&gt;</code><span style="opacity:.7">?XTransformPort=3003</span>.
      <div style="margin-top:6px">Điền HUB PUBLIC BASE URL để tự thay <code class="ic">{HUB}</code> trong mọi ví dụ:
      <input id="hub-base-input" type="url" placeholder="https://<hub-host>" spellcheck="false" autocomplete="off"></div>
    </div>
${API_DOCS.map(renderSection).join('\n')}
    <div class="dhint">Nguồn sự thật wire contract: <code class="ic">docs/api.md</code> + <code class="ic">packages/protocol</code>.
    Site này là bản EXPORT STATIC của tab Docs trên Hub UI (repo <code class="ic">kungfufanta/ZaiWebHub</code>, script <code class="ic">apps/dev-console/scripts/export-docs-site.ts</code>).</div>
  </main>
</div>
<footer class="foot">
  <div class="footin">
    <span>ZaiWebHub docs — static site cho GitHub Pages · ${esc(DOC_META.source)}</span>
    <span class="mono">OpenAI-compatible · SSE · least-loaded dispatch</span>
  </div>
</footer>
<script>${buildJS()}</script>
</body>
</html>
`;
}

/* ---------- main ---------- */

function main(): void {
  const outDir = join(import.meta.dir, '..', 'docs-site');
  const outPath = join(outDir, 'index.html');
  mkdirSync(outDir, { recursive: true });
  const html = buildHTML();
  writeFileSync(outPath, html, 'utf8');
  const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`[export-docs] wrote ${outPath} (${kb} KB, ${API_DOCS.length} sections, ${codeSeq} code blocks)`);
}

main();
