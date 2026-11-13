'use client';

import { Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ChatMessage, LiveStreamStats } from '@/lib/chat-types';
import { formatCount, formatMs } from '@/lib/chat-utils';
import { cn } from '@/lib/utils';

interface StreamStatsBarProps {
  live: LiveStreamStats | null;
  lastMessage: ChatMessage | null;
  streaming: boolean;
  eventCount: number;
  logOpen: boolean;
  onToggleLog: () => void;
}

const STATUS_META: Record<string, { label: string; dot: string; pulse?: boolean; text?: string }> = {
  connecting: { label: 'Đang kết nối', dot: 'bg-amber-500', pulse: true },
  thinking: { label: 'Đang suy luận', dot: 'bg-amber-500', pulse: true },
  answering: { label: 'Đang trả lời', dot: 'bg-emerald-500', pulse: true },
  finalizing: { label: 'Đang kết thúc', dot: 'bg-emerald-500', pulse: true },
  streaming: { label: 'Đang stream', dot: 'bg-amber-500', pulse: true },
  done: { label: 'Hoàn tất', dot: 'bg-emerald-500' },
  stopped: { label: 'Đã dừng', dot: 'bg-zinc-400' },
  interrupted: { label: 'Đứt kết nối', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  error: { label: 'Lỗi', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  idle: { label: 'Sẵn sàng', dot: 'bg-muted-foreground/50' },
};

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted/70 px-2 py-1 font-mono text-[11px] leading-4">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </span>
  );
}

/**
 * Live monitor strip: shows stream phase, latency and throughput so it is
 * easy to verify that the thinking -> answer stream is not interrupted.
 */
export function StreamStatsBar({
  live,
  lastMessage,
  streaming,
  eventCount,
  logOpen,
  onToggleLog,
}: StreamStatsBarProps) {
  const statusKey = live
    ? live.phase
    : lastMessage && !streaming
      ? lastMessage.status
      : 'idle';
  const meta = STATUS_META[statusKey] ?? STATUS_META.idle;

  const ttfb = live ? live.ttfbMs : (lastMessage?.metrics?.ttfbMs ?? null);
  const thinking = live ? live.thinkingMs : (lastMessage?.metrics?.thinkingMs ?? null);
  const total = live ? live.elapsedMs : (lastMessage?.metrics?.totalMs ?? null);
  const reasoningChars = live ? live.reasoningChars : (lastMessage?.metrics?.reasoningChars ?? null);
  const answerChars = live ? live.answerChars : (lastMessage?.metrics?.answerChars ?? null);
  const cps = live ? live.charsPerSec : (lastMessage?.metrics?.answerCharsPerSec ?? null);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2 sm:px-4">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium leading-4',
          meta.text,
        )}
      >
        <span
          className={cn('h-1.5 w-1.5 rounded-full', meta.dot, meta.pulse && 'animate-pulse')}
          aria-hidden="true"
        />
        {meta.label}
      </span>

      <Chip label="TTFB" value={formatMs(ttfb)} />
      <Chip label="Thinking" value={formatMs(thinking)} />
      <Chip label="Tổng" value={formatMs(total)} />
      <Chip label="Suy luận" value={`${formatCount(reasoningChars)}c`} />
      <Chip label="Trả lời" value={`${formatCount(answerChars)}c`} />
      <Chip label="Tốc độ" value={cps != null ? `${cps}c/s` : '—'} />

      <div className="ml-auto">
        <Button
          variant={logOpen ? 'default' : 'outline'}
          size="sm"
          className="h-6 gap-1 rounded-full px-2.5 text-[11px]"
          onClick={onToggleLog}
          aria-pressed={logOpen}
        >
          <Terminal className="h-3 w-3" aria-hidden="true" />
          Nhật ký SSE ({eventCount})
        </Button>
      </div>
    </div>
  );
}
