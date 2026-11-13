'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Eraser, Menu, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Composer } from '@/components/chat/composer';
import { EventLog } from '@/components/chat/event-log';
import { MessageList } from '@/components/chat/message-list';
import { SessionSidebar } from '@/components/chat/session-sidebar';
import { StreamStatsBar } from '@/components/chat/stream-stats-bar';
import { useToast } from '@/hooks/use-toast';
import { useChatSessions } from '@/hooks/use-chat-sessions';
import type {
  ChatMessage,
  EventLogEntry,
  LiveStreamStats,
  MessageStatus,
} from '@/lib/chat-types';
import { MODEL_OPTIONS, buildHistory, createMessage } from '@/lib/chat-utils';
import { streamChat } from '@/lib/sse-client';
import { cn } from '@/lib/utils';

const SETTINGS_KEY = 'zaiwebhub-dev-console.settings.v1';

interface StreamSettings {
  model: string;
  thinkingEnabled: boolean;
  errorTest: boolean;
  systemPrompt: string;
  maxHistory: number;
  logOpen: boolean;
}

const DEFAULT_SETTINGS: StreamSettings = {
  model: 'glm-5.3',
  thinkingEnabled: true,
  errorTest: false,
  systemPrompt: '',
  maxHistory: 40,
  logOpen: false,
};

export function ChatTester() {
  const store = useChatSessions();
  const { toast } = useToast();

  // Stream configuration (persisted to localStorage)
  const [settings, setSettings] = useState<StreamSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // UI / stream state
  const [input, setInput] = useState('');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [live, setLive] = useState<LiveStreamStats | null>(null);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [navOpen, setNavOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);

  const session = store.activeSession;
  const messages = session?.messages ?? [];
  const streaming = streamingMessageId !== null;

  const updateSetting = <K extends keyof StreamSettings>(key: K, value: StreamSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Hydrate settings once from localStorage (deferred so it never blocks paint).
  useEffect(() => {
    const timer = setTimeout(() => {
      let parsed: Partial<StreamSettings> | null = null;
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (raw) parsed = JSON.parse(raw) as Partial<StreamSettings>;
      } catch {
        parsed = null;
      }
      const merged: StreamSettings = {
        model: typeof parsed?.model === 'string' ? parsed.model : DEFAULT_SETTINGS.model,
        thinkingEnabled:
          typeof parsed?.thinkingEnabled === 'boolean'
            ? parsed.thinkingEnabled
            : DEFAULT_SETTINGS.thinkingEnabled,
        errorTest:
          typeof parsed?.errorTest === 'boolean'
            ? parsed.errorTest
            : DEFAULT_SETTINGS.errorTest,
        systemPrompt:
          typeof parsed?.systemPrompt === 'string'
            ? parsed.systemPrompt
            : DEFAULT_SETTINGS.systemPrompt,
        maxHistory:
          typeof parsed?.maxHistory === 'number' &&
          parsed.maxHistory >= 2 &&
          parsed.maxHistory <= 200
            ? Math.round(parsed.maxHistory)
            : DEFAULT_SETTINGS.maxHistory,
        logOpen: typeof parsed?.logOpen === 'boolean' ? parsed.logOpen : DEFAULT_SETTINGS.logOpen,
      };
      setSettings(merged);
      setSettingsLoaded(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Persist settings whenever they change.
  useEffect(() => {
    if (!settingsLoaded) return;
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // ignore storage errors
    }
  }, [settingsLoaded, settings]);

  // Abort any in-flight stream when unmounting.
  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const historyCount = useMemo(
    () => buildHistory(messages, settings.maxHistory, settings.systemPrompt).length,
    [messages, settings.maxHistory, settings.systemPrompt],
  );

  async function runStream(
    sessionId: string,
    assistantId: string,
    history: { role: string; content: string }[],
  ) {
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    setStreamingMessageId(assistantId);
    setEventLog([]);
    setLive({
      phase: 'connecting',
      elapsedMs: 0,
      ttfbMs: null,
      thinkingMs: null,
      reasoningChars: 0,
      answerChars: 0,
      charsPerSec: null,
      eventCount: 0,
    });

    const t0 = performance.now();
    let ttfbAt: number | null = null;
    let thinkingStartAt: number | null = null;
    let answerStartAt: number | null = null;
    let reasoning = '';
    let content = '';
    let sawFinish = false;
    let sawDone = false;
    let errorText: string | null = null;
    let eventCount = 0;
    let phase: LiveStreamStats['phase'] = 'connecting';
    let lastPaint = 0;

    const paint = (force = false) => {
      const now = performance.now();
      if (!force && now - lastPaint < 90) return;
      lastPaint = now;
      const answerMs = answerStartAt !== null ? now - answerStartAt : null;
      setLive({
        phase,
        elapsedMs: Math.round(now - t0),
        ttfbMs: ttfbAt === null ? null : Math.round(ttfbAt - t0),
        thinkingMs:
          thinkingStartAt === null
            ? null
            : Math.round((answerStartAt ?? now) - thinkingStartAt),
        reasoningChars: reasoning.length,
        answerChars: content.length,
        charsPerSec:
          answerMs && answerMs > 0 ? Math.round((content.length / answerMs) * 1000) : null,
        eventCount,
      });
    };

    const logEvent = (name: string, bytes: number, preview: string) => {
      eventCount += 1;
      const entry: EventLogEntry = {
        id: eventCount,
        offsetMs: Math.round(performance.now() - t0),
        name,
        bytes,
        preview,
      };
      setEventLog((prev) => (prev.length >= 300 ? [...prev.slice(1), entry] : [...prev, entry]));
    };

    const patch = (p: Partial<ChatMessage>) => store.patchMessage(sessionId, assistantId, p);

    try {
      await streamChat({
        messages: history,
        model: settings.model,
        thinking: settings.thinkingEnabled,
        errorTest: settings.errorTest,
        signal: controller.signal,
        onEvent: (ev) => {
          if (ttfbAt === null) ttfbAt = performance.now();
          switch (ev.type) {
            case 'thinking_start':
              thinkingStartAt = performance.now();
              phase = 'thinking';
              logEvent('thinking_start', 0, '');
              paint(true);
              break;
            case 'thinking_delta':
              reasoning += ev.delta;
              logEvent('thinking_delta', ev.delta.length, ev.delta.slice(0, 80));
              patch({ reasoning });
              paint();
              break;
            case 'answer_start':
              answerStartAt = performance.now();
              phase = 'answering';
              logEvent('answer_start', 0, '');
              patch({ reasoning });
              paint(true);
              break;
            case 'answer_delta':
              content += ev.delta;
              logEvent('answer_delta', ev.delta.length, ev.delta.slice(0, 80));
              patch({ content });
              paint();
              break;
            case 'finish':
              sawFinish = true;
              phase = 'finalizing';
              logEvent(`finish: ${ev.reason}`, 0, '');
              break;
            case 'error':
              errorText = ev.message;
              logEvent('error', 0, ev.message.slice(0, 140));
              break;
            case 'done':
              sawDone = true;
              logEvent('done [DONE]', 0, '');
              break;
            case 'stream_end':
              logEvent('stream_end', 0, '');
              break;
          }
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        errorText = err instanceof Error ? err.message : 'Lỗi mạng khi đọc stream.';
      }
    }

    // Finalize the assistant message with truthful status + metrics.
    const endAt = performance.now();
    let status: MessageStatus;
    if (errorText) status = 'error';
    else if (controller.signal.aborted) status = 'stopped';
    else if (sawFinish && sawDone) status = 'done';
    else status = 'interrupted';

    const thinkingMs =
      thinkingStartAt === null
        ? null
        : Math.round((answerStartAt ?? endAt) - thinkingStartAt);
    const answerMs = answerStartAt === null ? null : Math.round(endAt - answerStartAt);
    const charsPerSec =
      answerMs && answerMs > 0 && content.length > 0
        ? Math.round((content.length / answerMs) * 1000)
        : null;

    patch({
      reasoning,
      content,
      status,
      ...(errorText ? { error: errorText } : {}),
      metrics: {
        ttfbMs: ttfbAt === null ? null : Math.round(ttfbAt - t0),
        thinkingMs,
        answerMs,
        totalMs: Math.round(endAt - t0),
        reasoningChars: reasoning.length,
        answerChars: content.length,
        answerCharsPerSec: charsPerSec,
        sawFinish,
        sawDone,
        eventCount,
      },
    });

    streamingRef.current = false;
    abortRef.current = null;
    setStreamingMessageId(null);
    setLive(null);

    if (status === 'interrupted') {
      toast({
        variant: 'destructive',
        title: 'Stream bị đứt kết nối',
        description:
          'Kết nối kết thúc mà không nhận đủ sự kiện finish/[DONE]. Dùng "Thử lại" để gửi lại.',
      });
    } else if (status === 'error') {
      toast({
        variant: 'destructive',
        title: 'Lỗi stream',
        description: errorText ?? 'Đã xảy ra lỗi.',
      });
    }
  }

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streamingRef.current) return;
    const currentSession = store.activeSession ?? store.createNewSession();
    const userMsg = createMessage({ role: 'user', content: text });
    const assistantMsg = createMessage({ role: 'assistant', status: 'streaming' });
    const history = buildHistory(
      [...currentSession.messages, userMsg],
      settings.maxHistory,
      settings.systemPrompt,
    );
    store.appendMessages(currentSession.id, [userMsg, assistantMsg]);
    if (currentSession.messages.length === 0) {
      store.renameSession(currentSession.id, text.length > 60 ? `${text.slice(0, 60)}…` : text);
    }
    setInput('');
    await runStream(currentSession.id, assistantMsg.id, history);
  };

  const stopStream = () => {
    abortRef.current?.abort();
  };

  const handleRetry = async (messageId: string) => {
    if (streamingRef.current || !session) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const history = buildHistory(
      messages.slice(0, idx),
      settings.maxHistory,
      settings.systemPrompt,
    );
    if (history.length === 0) {
      toast({ title: 'Không thể thử lại', description: 'Không còn lịch sử nào để gửi lại.' });
      return;
    }
    const replacement = createMessage({ role: 'assistant', status: 'streaming' });
    store.removeMessage(session.id, messageId);
    store.appendMessages(session.id, [replacement]);
    await runStream(session.id, replacement.id, history);
  };

  const handleClearChat = () => {
    if (streamingRef.current || !session) return;
    store.clearMessages(session.id);
    setEventLog([]);
  };

  const handleDeleteSession = (id: string) => {
    store.deleteSession(id);
    toast({ title: 'Đã xóa phiên chat' });
  };

  const handleClearAll = () => {
    store.clearAllSessions();
    toast({ title: 'Đã xóa toàn bộ dữ liệu phiên chat' });
  };

  const sidebar = (variant: 'desktop' | 'mobile') => (
    <SessionSidebar
      sessions={store.sessions}
      activeId={store.activeSessionId}
      onSelect={(id) => {
        store.selectSession(id);
        if (variant === 'mobile') setNavOpen(false);
      }}
      onNew={() => {
        store.createNewSession();
        if (variant === 'mobile') setNavOpen(false);
      }}
      onDelete={handleDeleteSession}
      onClearAll={() => {
        handleClearAll();
        if (variant === 'mobile') setNavOpen(false);
      }}
      className={variant === 'mobile' ? 'min-h-0 flex-1' : 'h-full rounded-xl border bg-card'}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
      <div className="flex min-h-0 flex-1 gap-4">
        <nav
          aria-label="Danh sách phiên chat"
          className="hidden w-56 shrink-0 lg:block xl:w-64"
        >
          {sidebar('desktop')}
        </nav>

        <Sheet open={navOpen} onOpenChange={setNavOpen}>
          <SheetContent side="left" className="flex w-72 flex-col gap-0 p-0">
            <SheetHeader className="border-b px-3 py-2.5">
              <SheetTitle className="text-sm">Phiên chat</SheetTitle>
            </SheetHeader>
            {sidebar('mobile')}
          </SheetContent>
        </Sheet>

        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card"
          aria-label="Khung chat kiểm tra stream"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-4">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              onClick={() => setNavOpen(true)}
              aria-label="Mở danh sách phiên chat"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {session?.title ?? 'Phiên chat mới'}
              </p>
              {session && (
                <p className="text-[10px] text-muted-foreground">
                  {session.messages.length} tin nhắn trong phiên
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => updateSetting('thinkingEnabled', !settings.thinkingEnabled)}
              aria-pressed={settings.thinkingEnabled}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                settings.thinkingEnabled
                  ? 'border-amber-300/70 bg-amber-500/15 text-amber-700 dark:border-amber-700/60 dark:text-amber-400'
                  : 'border-border text-muted-foreground hover:bg-muted',
              )}
            >
              <Brain className="h-3.5 w-3.5" aria-hidden="true" />
              Thinking
            </button>
            <Badge variant="outline" className="hidden font-mono text-[10px] sm:inline-flex">
              {settings.model}
            </Badge>

            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Cài đặt stream"
                >
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="model-select" className="text-xs">
                      Model
                    </Label>
                    <Select
                      value={settings.model}
                      onValueChange={(m) => updateSetting('model', m)}
                    >
                      <SelectTrigger id="model-select" className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((m) => (
                          <SelectItem key={m} value={m} className="text-xs">
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label htmlFor="thinking-switch" className="text-xs">
                        Thinking mode
                      </Label>
                      <p className="text-[11px] text-muted-foreground">
                        Tách dòng suy luận reasoning_content
                      </p>
                    </div>
                    <Switch
                      id="thinking-switch"
                      checked={settings.thinkingEnabled}
                      onCheckedChange={(v) => updateSetting('thinkingEnabled', v)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="system-prompt" className="text-xs">
                      System prompt (tùy chọn)
                    </Label>
                    <Textarea
                      id="system-prompt"
                      value={settings.systemPrompt}
                      onChange={(e) => updateSetting('systemPrompt', e.target.value)}
                      rows={3}
                      className="text-xs"
                      placeholder="VD: Bạn là chuyên gia phân tích sản phẩm..."
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="max-history" className="text-xs">
                      Bộ nhớ tối đa (số tin nhắn gửi kèm)
                    </Label>
                    <Input
                      id="max-history"
                      type="number"
                      min={2}
                      max={200}
                      value={settings.maxHistory}
                      onChange={(e) =>
                        updateSetting(
                          'maxHistory',
                          Math.max(2, Math.min(200, Math.round(Number(e.target.value) || 40))),
                        )
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Cấu hình áp dụng cho mọi phiên chat và được lưu trên trình duyệt này.
                  </p>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleClearChat}
              disabled={streaming || !session || messages.length === 0}
              aria-label="Xóa hội thoại hiện tại"
            >
              <Eraser className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <StreamStatsBar
            live={live}
            lastMessage={messages[messages.length - 1] ?? null}
            streaming={streaming}
            eventCount={eventLog.length}
            logOpen={settings.logOpen}
            onToggleLog={() => updateSetting('logOpen', !settings.logOpen)}
          />

          <MessageList
            messages={messages}
            streamingMessageId={streamingMessageId}
            live={live}
            onRetry={handleRetry}
            onPickPrompt={(t) => setInput(t)}
          />

          {settings.logOpen && <EventLog entries={eventLog} onClear={() => setEventLog([])} />}

          <Composer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onStop={stopStream}
            streaming={streaming}
            historyCount={historyCount}
            empty={messages.length === 0}
            errorTest={settings.errorTest}
            onErrorTestChange={(v) => updateSetting('errorTest', v)}
          />
        </section>
      </div>
    </div>
  );
}
