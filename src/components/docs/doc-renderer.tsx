'use client';

// doc-renderer (3.7-D) — render DocBlock từ src/lib/api-docs.ts.
// Dùng chung cho trang /docs. Site static có renderer riêng (vanilla JS, cùng nội dung).
import { useCallback, useState } from 'react';
import { Check, Copy, Info, TriangleAlert } from 'lucide-react';
import type { DocBlock, DocEndpoint, HttpMethod } from '@/lib/api-docs';
import { cn } from '@/lib/utils';

/* ---------- inline text: parse `code` và **bold** ---------- */

type InlineToken = { t: 'code' | 'bold' | 'plain'; s: string };

function inlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: 'plain', s: text.slice(last, m.index) });
    if (m[1] !== undefined) tokens.push({ t: 'code', s: m[1] });
    else tokens.push({ t: 'bold', s: m[2] });
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push({ t: 'plain', s: text.slice(last) });
  return tokens;
}

export function InlineText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {inlineTokens(text).map((tok, i) => {
        if (tok.t === 'code') {
          return (
            <code
              key={i}
              className="break-words rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground"
            >
              {tok.s}
            </code>
          );
        }
        if (tok.t === 'bold') {
          return (
            <strong key={i} className="font-semibold">
              {tok.s}
            </strong>
          );
        }
        return <span key={i}>{tok.s}</span>;
      })}
    </span>
  );
}

/* ---------- method badge ---------- */

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: 'border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:border-emerald-500/50 dark:text-emerald-400',
  POST: 'border-amber-600/40 bg-amber-500/15 text-amber-700 dark:border-amber-500/50 dark:text-amber-400',
  SSE: 'border-violet-600/40 bg-violet-500/15 text-violet-700 dark:border-violet-500/50 dark:text-violet-400',
  WS: 'border-rose-600/40 bg-rose-500/15 text-rose-700 dark:border-rose-500/50 dark:text-rose-400',
};

export function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        METHOD_STYLES[method],
      )}
    >
      {method}
    </span>
  );
}

/* ---------- code block với copy ---------- */

export function CodeBlock({
  lang,
  title,
  code,
  hubBase,
}: {
  lang: CodeLang;
  title?: string;
  code: string;
  hubBase?: string;
}) {
  const [copied, setCopied] = useState(false);
  const effective = hubBase ? code.replaceAll('{HUB}', hubBase) : code;

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(effective);
    } catch {
      // fallback: textarea ẩn (browser chặn clipboard API)
      const ta = document.createElement('textarea');
      ta.value = effective;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [effective]);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-300 bg-zinc-950 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-zinc-400">{title ?? ''}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase text-zinc-400">
            {lang}
          </span>
          <button
            type="button"
            onClick={() => void onCopy()}
            aria-label={copied ? 'Đã copy' : 'Copy code'}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        </span>
      </div>
      <pre className="max-h-[560px] overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-zinc-100 sm:text-xs">
        <code className="whitespace-pre">{effective}</code>
      </pre>
    </div>
  );
}

/* ---------- block renderer ---------- */

export function BlocksRenderer({ blocks, hubBase }: { blocks: DocBlock[]; hubBase?: string }) {
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'p':
            return (
              <p key={i} className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
                <InlineText text={block.text} />
              </p>
            );
          case 'list':
            return (
              <ul key={i} className="space-y-1.5">
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    className="flex gap-2 text-xs leading-relaxed text-muted-foreground sm:text-sm"
                  >
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <span>
                      <InlineText text={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      {block.headers.map((h, j) => (
                        <th
                          key={j}
                          scope="col"
                          className="whitespace-nowrap px-3 py-2 font-semibold text-foreground"
                        >
                          <InlineText text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {block.rows.map((row, j) => (
                      <tr key={j} className="align-top">
                        {row.map((cell, k) => (
                          <td
                            key={k}
                            className={cn(
                              'px-3 py-2 leading-relaxed text-muted-foreground',
                              k === 0 && 'whitespace-nowrap font-medium text-foreground',
                            )}
                          >
                            <InlineText text={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'note': {
            const info = block.tone === 'info';
            return (
              <div
                key={i}
                role="note"
                className={cn(
                  'flex gap-2.5 rounded-lg border px-3 py-2.5',
                  info
                    ? 'border-emerald-600/30 bg-emerald-500/10'
                    : 'border-amber-600/30 bg-amber-500/10',
                )}
              >
                {info ? (
                  <Info
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : (
                  <TriangleAlert
                    className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                )}
                <p
                  className={cn(
                    'text-xs leading-relaxed sm:text-sm',
                    info
                      ? 'text-emerald-800 dark:text-emerald-300'
                      : 'text-amber-800 dark:text-amber-300',
                  )}
                >
                  <InlineText text={block.text} />
                </p>
              </div>
            );
          }
          case 'code':
            return (
              <CodeBlock
                key={i}
                lang={block.lang}
                title={block.title}
                code={block.code}
                hubBase={hubBase}
              />
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

/* ---------- endpoint card ---------- */

export function EndpointCard({ endpoint, hubBase }: { endpoint: DocEndpoint; hubBase?: string }) {
  return (
    <article
      id={endpoint.id}
      className="scroll-mt-24 rounded-xl border bg-card shadow-xs"
      aria-label={`${endpoint.method} ${endpoint.path}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <MethodBadge method={endpoint.method} />
        <code className="min-w-0 break-all font-mono text-xs font-semibold text-foreground sm:text-sm">
          {endpoint.path}
        </code>
        <span className="w-full text-[11px] leading-relaxed text-muted-foreground sm:w-auto sm:flex-1 sm:text-xs">
          {endpoint.summary}
        </span>
      </div>
      <div className="px-3 py-3 sm:px-4">
        <BlocksRenderer blocks={endpoint.blocks} hubBase={hubBase} />
      </div>
    </article>
  );
}
