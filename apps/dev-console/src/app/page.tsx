import { BrainCircuit } from 'lucide-react';
import { ChatTester } from '@/components/chat/chat-tester';
import { Badge } from '@/components/ui/badge';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BrainCircuit className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold sm:text-base">ZaiWebHub dev-console</h1>
            <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
              SSE harness upstream-native (F4) · thinking tự động theo reasoning_content · phiên chat có bộ nhớ
            </p>
          </div>
          <Badge
            variant="outline"
            className="ml-auto shrink-0 border-sky-500/50 bg-sky-500/10 font-mono text-[10px] font-medium text-sky-700 dark:border-sky-700/60 dark:text-sky-400"
          >
            mock · adapter · webhub
          </Badge>
        </div>
      </header>

      <main
        aria-label="Khu vực chat kiểm tra stream"
        className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col px-3 sm:px-4"
      >
        <ChatTester />
      </main>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
          <p className="text-xs text-muted-foreground">
            ZaiWebHub dev-console — port 3005 · endpoint chọn trong stats bar
          </p>
          <p className="hidden font-mono text-[10px] text-muted-foreground md:block">
            delta.reasoning_content → delta.content → finish_reason + usage → [DONE]
          </p>
        </div>
      </footer>
    </div>
  );
}
