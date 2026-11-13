'use client';

// ZaiWebHub — Unified Hub UI (1 repo, 1 route, sandbox edition)
// Sandbox chỉ expose 1 route "/" + port 3000 qua Caddy gateway → toàn bộ UI gom về
// 1 trang với 5 tab client-side (không next/link):
//   Console — chat tester SSE 3 mode (mock / adapter / webhub E2E)
//   Workers — pool worker từ hub :3003 (qua /api/workers giữ secret server-side)
//   Stats   — uptime + jobs per worker
//   Docs    — API reference kiểu OpenAI ({HUB} tự điền origin)
//   Worker node — dashboard worker cục bộ :3005 (setup/status mini-service)
// Hub thật chạy mini-services/hub :3003; worker runtime chạy mini-services/worker :3005.
import { useEffect, useState } from 'react';
import { Waypoints } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ChatTester } from '@/components/chat/chat-tester';
import { WorkersPanel } from '@/components/hub/workers-panel';
import { StatsPanel } from '@/components/hub/stats-panel';
import { DocsPanel } from '@/components/hub/docs-panel';
import { WorkerPanel } from '@/components/worker/worker-panel';
import { HubNav, type HubTab } from '@/components/hub/hub-nav';

const TAB_STORAGE_KEY = 'zaiwebhub.hubtab.v1';

function isHubTab(value: unknown): value is HubTab {
  return value === 'console' || value === 'workers' || value === 'stats' || value === 'docs' || value === 'worker';
}

export default function HubPage() {
  const [tab, setTab] = useState<HubTab>('console');

  // nhớ tab đang mở — restore sau hydration (tránh mismatch: server render 'console')
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore 1 lần sau hydration, không có cascade
      if (isHubTab(saved)) setTab(saved);
    } catch {
      /* localStorage chặn — dùng default */
    }
  }, []);

  const changeTab = (next: HubTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <HubNav active={tab} onChange={changeTab} />

      <div aria-live="polite" className="flex min-h-0 flex-1 flex-col">
        {tab === 'console' && (
          <main
            aria-label="Khu vực chat kiểm tra stream"
            className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col px-3 sm:px-4"
          >
            <ChatTester />
          </main>
        )}
        {tab === 'workers' && <WorkersPanel />}
        {tab === 'stats' && <StatsPanel />}
        {tab === 'docs' && <DocsPanel />}
        {tab === 'worker' && <WorkerPanel />}
      </div>

      <footer className="mt-auto border-t bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2.5 sm:px-4">
          <p className="text-xs text-muted-foreground">
            ZaiWebHub 1-repo · console :3000 · hub :3003 (mini-service) · worker :3005 (mini-service)
          </p>
          <Badge
            variant="outline"
            className="hidden shrink-0 border-sky-500/50 bg-sky-500/10 font-mono text-[10px] font-medium text-sky-700 md:inline-flex dark:border-sky-700/60 dark:text-sky-400"
          >
            <Waypoints className="mr-1 h-3 w-3" aria-hidden="true" />
            mock · adapter · webhub E2E
          </Badge>
        </div>
      </footer>
    </div>
  );
}
