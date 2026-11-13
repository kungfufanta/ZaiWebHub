'use client';

import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

/**
 * Lightweight markdown renderer for streamed model output.
 * Keeps styling minimal and resilient to partial markdown.
 */
export function MarkdownLite({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h4>
          ),
          p: ({ children }) => (
            <p className="mb-2 whitespace-pre-wrap break-words last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>
          ),
          li: ({ children }) => <li className="break-words">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-2 border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="mb-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted/60 px-2 py-1 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-2 py-1 align-top">{children}</td>
          ),
          pre: ({ children }) => (
            <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed">
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            const isBlock = typeof className === 'string' && className.includes('language-');
            if (isBlock) {
              return <code className={cn('font-mono text-xs', className)}>{children}</code>;
            }
            return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
