'use client';

import { AlertTriangle, SendHorizontal, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SAMPLE_PROMPTS } from '@/lib/chat-utils';
import type { EndpointMode } from '@/lib/endpoints';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  historyCount: number;
  empty: boolean;
  /** Chế độ endpoint — error_test chỉ áp dụng cho mock. */
  mode: EndpointMode;
  /** Khi bật (mode mock): lượt gửi kế tiếp kèm error_test=true → event:error giữa stream. */
  errorTest: boolean;
  onErrorTestChange: (value: boolean) => void;
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  streaming,
  historyCount,
  empty,
  mode,
  errorTest,
  onErrorTestChange,
}: ComposerProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!streaming && value.trim()) onSend();
    }
  };

  return (
    <div className="shrink-0 border-t px-3 py-3 sm:px-4">
      {empty && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => onChange(p.text)}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
            >
              {p.title}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nhập prompt ý tưởng để kiểm tra stream thinking..."
          rows={1}
          className="min-h-11 max-h-44 flex-1 resize-none field-sizing-content"
          aria-label="Nội dung tin nhắn"
        />
        {streaming ? (
          <Button variant="destructive" onClick={onStop} className="h-11 shrink-0 gap-1.5">
            <Square className="h-4 w-4" aria-hidden="true" />
            Dừng
          </Button>
        ) : (
          <Button
            onClick={onSend}
            disabled={!value.trim()}
            className="h-11 shrink-0 gap-1.5"
            aria-label="Gửi tin nhắn"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
            Gửi
          </Button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {mode === 'mock' ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="error-test-toggle"
              checked={errorTest}
              onCheckedChange={(checked) => onErrorTestChange(checked === true)}
              className="h-3.5 w-3.5"
              aria-label="Bật mock lỗi stream (error_test) cho lượt gửi kế tiếp"
            />
            <Label
              htmlFor="error-test-toggle"
              className="cursor-pointer text-[11px] font-normal text-muted-foreground"
            >
              Mock lỗi stream (error_test)
            </Label>
          </div>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            error_test chỉ khả dụng ở chế độ Mock.
          </span>
        )}
        {mode === 'mock' && errorTest && (
          <span className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Lượt gửi kế tiếp sẽ nhận event:error sau 2 chunk suy luận
          </span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Enter để gửi, Shift+Enter xuống dòng. Bộ nhớ phiên: {historyCount} tin nhắn được gửi kèm mỗi
        lượt.
      </p>
    </div>
  );
}
