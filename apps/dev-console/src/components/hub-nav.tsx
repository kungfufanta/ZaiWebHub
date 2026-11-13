'use client';

// Hub UI nav — 3 tab (3.6-H): Console (giữ nguyên) / Workers / Stats.
// Sticky trên cùng, active theo pathname, responsive mobile (icon + label gọn).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Gauge, MessagesSquare, Server, Waypoints } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/', label: 'Console', icon: MessagesSquare },
  { href: '/workers', label: 'Workers', icon: Server },
  { href: '/stats', label: 'Stats', icon: Gauge },
] as const;

export function HubNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Hub navigation"
      className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2 px-3 py-1.5 sm:px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 hover:bg-accent"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Waypoints className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <span className="truncate text-xs font-semibold sm:text-sm">ZaiWebHub Hub UI</span>
        </Link>
        <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Tab chính">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                role="tab"
                aria-selected={active}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors sm:text-sm',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
