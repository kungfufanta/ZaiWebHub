'use client';

import { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EventLogEntry } from '@/lib/chat-types';
import { cn } from '@/lib/utils';

interface EventLogProps {
  entries: EventLogEntry[];
  onClear: () => void;
}

const NAME_COLOR: Record<string, string> = {
  thinking_start: 'text-amber-600 dark:text-amber-400',
  thinking_delta: 'text-amber-600 dark:text-amber-400',
  answer_start: 'text-emerald-600 dark:text-emerald-400',
  answer_delta: 'text-emerald-600 dark:text-emerald-400',
  finish: 'text-violet-600 dark:text-violet-400',
  error: 'text-red-600 dark:text-red-400',
  done: 'text-muted-foreground',
  stream_end: 'text-muted-foreground',
};

/**
 * Raw SSE event monitor. Each row shows the offset from request start,
 * the event name, payload size and a short preview. Useful to confirm
 * events keep flowing without gaps.
 */
export function EventLog({ entries, onClear }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  return (
    <div className="shrink-0 border-t bg-muted/30 px-3 py-2 sm:px-4">
      <div className="mb-1.5 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
          Nhật ký sự kiện SSE ({entries.length})
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={onClear}
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Xóa
        </Button>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-44 overflow-y-auto rounded-md border bg-background font-mono text-[11px] leading-5"
        aria-label="Nhật ký sự kiện"
      >
        {entries.length === 0 ? (
          <p className="px-2 py-2 text-muted-foreground">Chưa có sự kiện nào trong lượt stream này.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex gap-2 border-b px-2 py-0.5 last:border-b-0">
              <span className="shrink-0 text-muted-foreground">+{e.offsetMs}ms</span>
              <span className={cn('shrink-0 font-semibold', NAME_COLOR[e.name] ?? 'text-foreground')}>
                {e.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {e.bytes > 0 ? `${e.bytes}B` : ''}
              </span>
              <span className="truncate text-muted-foreground">{e.preview}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
