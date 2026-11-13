'use client';

// Hub UI nav — tab-based (không dùng next/link vì sandbox chỉ expose 1 route "/").
// 5 tab: Console / Workers / Stats / Docs / Worker node (worker cục bộ :3005).
// Sticky trên cùng, controlled theo props, responsive mobile (icon + label gọn).
import { BookOpen, Gauge, MessagesSquare, Server, Waypoints, Radio } from 'lucide-react';
import { cn } from '@/lib/utils';

export type HubTab = 'console' | 'workers' | 'stats' | 'docs' | 'worker';

const TABS: { id: HubTab; label: string; icon: typeof MessagesSquare }[] = [
  { id: 'console', label: 'Console', icon: MessagesSquare },
  { id: 'workers', label: 'Workers', icon: Server },
  { id: 'stats', label: 'Stats', icon: Gauge },
  { id: 'docs', label: 'Docs', icon: BookOpen },
  { id: 'worker', label: 'Worker node', icon: Radio },
];

export function HubNav({ active, onChange }: { active: HubTab; onChange: (tab: HubTab) => void }) {
  return (
    <nav
      aria-label="Hub navigation"
      className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-1.5 sm:px-4">
        <span className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="truncate text-xs font-semibold sm:text-sm">ZaiWebHub Hub UI</span>
        </span>
        <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Tab chính">
          {TABS.map(({ id, label, icon: Icon }) => {
            const activeTab = active === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab}
                onClick={() => onChange(id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  activeTab
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
