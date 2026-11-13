'use client';

import { Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ChatMessage, LiveStreamStats } from '@/lib/chat-types';
import { ENDPOINT_MODES, endpointModeMeta, type EndpointMode } from '@/lib/endpoints';
import { formatCount, formatMs } from '@/lib/chat-utils';
import { cn } from '@/lib/utils';

interface StreamStatsBarProps {
  live: LiveStreamStats | null;
  lastMessage: ChatMessage | null;
  streaming: boolean;
  eventCount: number;
  logOpen: boolean;
  onToggleLog: () => void;
  /** Chế độ endpoint hiện tại (mock | adapter | webhub). */
  mode: EndpointMode;
  onModeChange: (mode: EndpointMode) => void;
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

function Chip({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[16rem] items-center gap-1 rounded-md bg-muted/70 px-2 py-1 text-[11px] leading-4',
        mono && 'font-mono',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate">{value}</span>
    </span>
  );
}

/**
 * Live monitor strip: stream phase, latency, throughput, endpoint mode switcher
 * (mock/adapter/webhub — T1-c nửa 2) và nhãn xác minh bắt buộc
 * (mock-verified khi Mock; no-reasoning (proxy) khi Adapter/WebHub trong sandbox —
 * G2-4: proxy sandbox KHÔNG emit reasoning_content thật).
 */
export function StreamStatsBar({
  live,
  lastMessage,
  streaming,
  eventCount,
  logOpen,
  onToggleLog,
  mode,
  onModeChange,
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
  const reasoningChunks = live
    ? live.reasoningChunks
    : (lastMessage?.metrics?.reasoningChunks ?? null);
  const answerChunks = live ? live.answerChunks : (lastMessage?.metrics?.answerChunks ?? null);
  const jobId = live ? live.jobId : (lastMessage?.metrics?.jobId ?? null);
  const requestId = live ? live.requestId : (lastMessage?.metrics?.requestId ?? null);

  const modeMeta = endpointModeMeta(mode);

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
      {reasoningChunks != null && (
        <Chip label="chunks" value={`${reasoningChunks}🧠/${answerChunks ?? 0}💬`} />
      )}

      {/* T4-a debug: hub set X-Job-Id / X-Request-Id trước khi stream */}
      {jobId && <Chip label="job" value={jobId} />}
      {requestId && <Chip label="req" value={requestId} />}

      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {/* Endpoint mode switcher — mặc định Mock (UI luôn chạy được không cần hub). */}
        <Select value={mode} onValueChange={(v) => onModeChange(v as EndpointMode)}>
          <SelectTrigger
            aria-label="Chọn endpoint stream"
            className="h-6 w-[9.5rem] gap-1 rounded-full px-2.5 text-[11px]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENDPOINT_MODES.map((m) => (
              <SelectItem key={m.value} value={m.value} className="text-xs">
                <span className="flex flex-col">
                  <span>{m.label}</span>
                  <span className="text-[10px] text-muted-foreground">{m.verifyLabel}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Nhãn xác minh bắt buộc (PLANS.md §8.7) — theo chế độ đang chọn */}
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 font-mono text-[10px]',
            mode === 'mock'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
          )}
        >
          {modeMeta.verifyLabel}
        </Badge>

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
