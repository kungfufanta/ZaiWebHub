'use client';

import { useEffect, useRef } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  CircleStop,
  Loader2,
  RotateCcw,
  WifiOff,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownLite } from '@/components/chat/markdown-lite';
import { ThinkingPanel } from '@/components/chat/thinking-panel';
import type { ChatMessage, LiveStreamStats, MessageStatus } from '@/lib/chat-types';
import { SAMPLE_PROMPTS, formatCount, formatMs } from '@/lib/chat-utils';
import { cn } from '@/lib/utils';

interface MessageListProps {
  messages: ChatMessage[];
  streamingMessageId: string | null;
  live: LiveStreamStats | null;
  onRetry: (messageId: string) => void;
  onPickPrompt: (text: string) => void;
}

function StatusBadge({ status }: { status: MessageStatus }) {
  switch (status) {
    case 'streaming':
      return (
        <Badge
          variant="outline"
          className="gap-1 border-amber-300/60 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          Đang stream
        </Badge>
      );
    case 'done':
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        >
          Hoàn tất
        </Badge>
      );
    case 'stopped':
      return (
        <Badge variant="outline" className="gap-1 border-zinc-400/50 text-zinc-600 dark:text-zinc-400">
          <CircleStop className="h-3 w-3" aria-hidden="true" />
          Đã dừng
        </Badge>
      );
    case 'interrupted':
      return (
        <Badge
          variant="outline"
          className="gap-1 border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
        >
          <WifiOff className="h-3 w-3" aria-hidden="true" />
          Đứt kết nối
        </Badge>
      );
    case 'error':
      return (
        <Badge
          variant="outline"
          className="gap-1 border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Lỗi
        </Badge>
      );
    default:
      return null;
  }
}

function MetricsLine({ message }: { message: ChatMessage }) {
  const m = message.metrics;
  if (!m) return null;
  return (
    <span className="font-mono text-[10px] leading-5 text-muted-foreground">
      TTFB {formatMs(m.ttfbMs)}
      {' · '}Thinking {formatMs(m.thinkingMs)}
      {' · '}Tổng {formatMs(m.totalMs)}
      {' · '}Suy luận {formatCount(m.reasoningChars)} ký tự
      {' · '}Trả lời {formatCount(m.answerChars)} ký tự
      {m.answerCharsPerSec != null ? ` · ${m.answerCharsPerSec} c/s` : ''}
      {m.reasoningChunks != null && m.answerChunks != null
        ? ` · ${m.reasoningChunks}🧠/${m.answerChunks}💬 chunks`
        : ''}
      {' · '}{m.eventCount} sự kiện
      {m.finishReason ? ` · finish=${m.finishReason}` : ''}
      {m.usage
        ? ` · usage ${m.usage.prompt_tokens}/${m.usage.completion_tokens}${
            m.usage.total_tokens != null ? `/${m.usage.total_tokens}` : ''
          }`
        : ''}
      {m.jobId ? ` · job=${m.jobId}` : ''}
      {m.requestId ? ` · req=${m.requestId}` : ''}
      {!m.sawFinish ? ' · không nhận được finish' : ''}
      {!m.sawDone ? ' · không nhận được [DONE]' : ''}
    </span>
  );
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground sm:max-w-[75%]">
        {message.content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  streaming,
  live,
  onRetry,
}: {
  message: ChatMessage;
  streaming: boolean;
  live: LiveStreamStats | null;
  onRetry: (messageId: string) => void;
}) {
  const thinkingActive = streaming && message.content.length === 0 && message.reasoning.length > 0;
  /**
   * F7 (không config): panel chỉ xuất hiện khi (a) thực sự có reasoning, hoặc
   * (b) đã yêu cầu thinking nhưng tới cuối stream upstream không trả reasoning nào
   * → placeholder "Upstream không trả reasoning (proxy sandbox)". Panel không bao giờ
   * chặn/ẩn câu trả lời (nằm trên bubble answer, collapsible).
   */
  const noReasoningPlaceholder =
    !streaming &&
    message.status === 'done' &&
    message.thinkingRequested === true &&
    message.reasoning.length === 0;
  const showThinking = message.reasoning.length > 0 || thinkingActive || noReasoningPlaceholder;
  const canRetry =
    (message.status === 'interrupted' || message.status === 'error' || message.status === 'stopped') &&
    !streaming;

  return (
    <div className="flex flex-col gap-2">
      {showThinking && (
        <ThinkingPanel
          reasoning={message.reasoning}
          active={thinkingActive}
          durationMs={message.metrics?.thinkingMs ?? live?.thinkingMs ?? null}
          placeholder={
            noReasoningPlaceholder ? 'Upstream không trả reasoning (proxy sandbox)' : null
          }
        />
      )}

      {message.content ? (
        <div className="rounded-2xl rounded-bl-md border bg-muted/40 px-4 py-2.5">
          <MarkdownLite content={message.content} />
          {streaming && (
            <span
              className="ml-0.5 inline-block h-3.5 w-2 animate-pulse bg-foreground/70 align-middle"
              aria-hidden="true"
            />
          )}
        </div>
      ) : message.status === 'streaming' && !thinkingActive ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          {message.reasoning.length > 0
            ? 'Suy luận xong, đang chờ câu trả lời...'
            : 'Đang kết nối tới endpoint...'}
        </div>
      ) : !message.content && message.status !== 'streaming' ? (
        <p className="text-xs italic text-muted-foreground">
          (Không nhận được nội dung trả lời)
        </p>
      ) : null}

      {message.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {message.error}
        </div>
      )}

      {message.status === 'interrupted' && (
        <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Kết nối SSE đã kết thúc mà không nhận đủ sự kiện <span className="font-mono">finish</span>{' '}
            / <span className="font-mono">[DONE]</span>. Stream có thể bị đứt đoạn giữa chừng.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge status={message.status} />
        <MetricsLine message={message} />
        {canRetry && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 gap-1 rounded-full px-2 text-[11px]"
            onClick={() => onRetry(message.id)}
          >
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Thử lại
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onPickPrompt }: { onPickPrompt: (text: string) => void }) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-8">
      <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
          <BrainCircuit className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Kiểm tra luồng SSE upstream-native: thinking → answer</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Gửi một prompt ý tưởng để theo dõi dòng suy luận và câu trả lời streaming theo thời gian
            thực. Wire là upstream nguyên bản (F4): chunk `delta.reasoning_content` → `delta.content`
            → chunk cuối `finish_reason` + `usage` → `[DONE]`. Chọn endpoint trong stats bar:
            <span className="font-mono"> Mock</span> (giả lập),
            <span className="font-mono"> Adapter</span> (streamChat thật),
            <span className="font-mono"> WebHub (E2E)</span> qua hub thật. Toàn bộ lịch sử hội
            thoại được gửi kèm mỗi lượt nên phiên có bộ nhớ giữa các lần hỏi.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Prompt mẫu để test:</p>
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => onPickPrompt(p.text)}
              className="rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <span className="text-xs font-medium">{p.title}</span>
              <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                {p.text}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MessageList({
  messages,
  streamingMessageId,
  live,
  onRetry,
  onPickPrompt,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto" onScroll={handleScroll}>
        <div className="flex min-h-full items-center justify-center px-4 py-8">
          <EmptyState onPickPrompt={onPickPrompt} />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4"
      aria-label="Danh sách tin nhắn"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.map((m) => {
          const streaming = m.id === streamingMessageId;
          return (
            <div
              key={m.id}
              className={cn(m.role === 'user' ? 'items-end' : 'items-start', 'flex flex-col')}
              aria-label={m.role === 'user' ? 'Tin nhắn của bạn' : 'Trả lời của trợ lý'}
            >
              {m.role === 'user' ? (
                <UserBubble message={m} />
              ) : (
                <AssistantBubble message={m} streaming={streaming} live={streaming ? live : null} onRetry={onRetry} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
