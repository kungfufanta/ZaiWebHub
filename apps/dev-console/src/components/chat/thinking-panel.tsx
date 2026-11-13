'use client';

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, Loader2 } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { formatCount, formatMs } from '@/lib/chat-utils';

interface ThinkingPanelProps {
  reasoning: string;
  /** True while thinking tokens are still arriving. */
  active: boolean;
  durationMs?: number | null;
}

/**
 * Collapsible panel that displays the streamed reasoning_content.
 * Auto-opens while the model is thinking and auto-collapses as soon as the
 * answer starts, unless the user toggled it manually.
 */
export function ThinkingPanel({ reasoning, active, durationMs }: ThinkingPanelProps) {
  // null = follow the `active` prop automatically; boolean = user override.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? active;
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active && open && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [reasoning, active, open]);

  return (
    <Collapsible open={open} onOpenChange={(next) => setUserOpen(next)}>
      <div
        className={cn(
          'overflow-hidden rounded-xl border transition-colors',
          active
            ? 'border-amber-300/80 bg-amber-50/70 dark:border-amber-700/60 dark:bg-amber-950/20'
            : 'border-amber-200/70 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/10',
        )}
      >
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100/60 dark:text-amber-300 dark:hover:bg-amber-900/30"
            aria-label={open ? 'Thu gọn phần suy luận' : 'Mở rộng phần suy luận'}
          >
            {active ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
            ) : (
              <Brain className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>Suy luận (thinking)</span>
            {durationMs != null && (
              <span className="text-amber-700/80 dark:text-amber-400/80">
                · {formatMs(durationMs)}
              </span>
            )}
            <span className="text-amber-700/80 dark:text-amber-400/80">
              · {formatCount(reasoning.length)} ký tự
            </span>
            <ChevronDown
              className={cn(
                'ml-auto h-4 w-4 shrink-0 transition-transform',
                open && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div
            ref={contentRef}
            className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-t border-amber-200/70 px-3 py-2 font-mono text-xs leading-relaxed text-amber-900/90 dark:border-amber-900/50 dark:text-amber-200/90"
          >
            {reasoning}
            {active && (
              <span
                className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-amber-500 align-middle"
                aria-hidden="true"
              />
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
