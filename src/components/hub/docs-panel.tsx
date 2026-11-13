'use client';

// Trang /docs (3.7-D) — API Reference kiểu OpenAI cho Hub UI.
// 100% client-side, KHÔNG phụ thuộc server data (poll/fetch) → export static được
// (scripts/export-docs-site.ts sinh site GitHub Pages từ cùng src/lib/api-docs.ts).
// Nội dung: sidebar TOC (desktop) + chips (mobile), scroll-spy, code block copy,
// {HUB} tự thay bằng origin hiện tại sau mount (tránh hydration mismatch).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ExternalLink } from 'lucide-react';
import { API_DOCS, DOC_META } from '@/lib/api-docs';
import { BlocksRenderer, EndpointCard } from '@/components/docs/doc-renderer';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// hubBase: origin hiện tại (public URL sandbox này) → ví dụ curl "chạy ngay".
// useSyncExternalStore = pattern chuẩn đọc browser-only value: server/hydration render '',
// sau hydration React tự re-render với origin — không hydration mismatch, không setState trong effect.
const EMPTY_BASE = '';
const subscribeOrigin = () => () => {};
const getOriginSnapshot = () => window.location.origin.replace(/\/+$/, '');
const getOriginServerSnapshot = () => EMPTY_BASE;

export function DocsPanel() {
  const hubBase = useSyncExternalStore(subscribeOrigin, getOriginSnapshot, getOriginServerSnapshot);
  const [activeId, setActiveId] = useState<string>(API_DOCS[0]?.id ?? '');

  // scroll-spy: highlight section đang xem trong sidebar
  useEffect(() => {
    const targets = API_DOCS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-72px 0px -65% 0px', threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <>
<div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-3 py-4 sm:px-4 sm:py-6">
        {/* ----- sidebar TOC (desktop) ----- */}
        <aside className="hidden w-56 shrink-0 lg:block" aria-label="Mục lục tài liệu">
          <nav className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto space-y-0.5 pb-4">
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Mục lục
            </p>
            {API_DOCS.map((s) => {
              const active = activeId === s.id;
              return (
                <div key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={active ? 'location' : undefined}
                    className={cn(
                      'block truncate rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    {s.title}
                  </a>
                  {s.endpoints?.map((e) => (
                    <a
                      key={e.id}
                      href={`#${e.id}`}
                      className="block truncate rounded-md py-1 pl-4 pr-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {e.method} {e.path}
                    </a>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* ----- content ----- */}
        <main className="min-w-0 flex-1">
          {/* chips mobile */}
          <nav
            className="mb-4 flex gap-1.5 overflow-x-auto pb-1 lg:hidden"
            aria-label="Mục lục tài liệu (mobile)"
          >
            {API_DOCS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-medium transition-colors',
                  activeId === s.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                {s.title}
              </a>
            ))}
          </nav>

          {hubBase && (
            <div className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground sm:text-sm">
              <span className="font-medium text-foreground">Base URL hiện tại của bạn: </span>
              <code className="break-all font-mono text-[11px] text-foreground sm:text-xs">
                {hubBase}
              </code>
              <span className="mt-0.5 block sm:ml-1 sm:inline">
                — các ví dụ bên dưới đã tự điền URL này (thay {'{HUB}'}).
              </span>
            </div>
          )}

          <div className="space-y-8">
            {API_DOCS.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className="scroll-mt-24"
                aria-label={section.title}
              >
                <h2 className="mb-1 text-base font-semibold tracking-tight sm:text-lg">
                  {section.title}
                </h2>
                {section.blurb && (
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                    {section.blurb}
                  </p>
                )}
                <div className="space-y-3">
                  {section.blocks ? (
                    <BlocksRenderer blocks={section.blocks} hubBase={hubBase} />
                  ) : null}
                  {section.endpoints?.map((e) => (
                    <EndpointCard key={e.id} endpoint={e} hubBase={hubBase} />
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground sm:text-sm">
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Nguồn sự thật wire contract: <code className="font-mono">docs/api.md</code> +{' '}
            <code className="font-mono">packages/protocol</code>. Trang này export được thành site
            static deploy GitHub Pages (
            <code className="font-mono">bun apps/dev-console/scripts/export-docs-site.ts</code>) —
            xem <code className="font-mono">docs/deploy/40-github-pages.md</code>.
          </div>
        </main>
      </div>

    </>
  );
}
