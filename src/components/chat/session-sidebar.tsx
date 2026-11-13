'use client';

import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { ChatSession } from '@/lib/chat-types';
import { formatTimeAgo } from '@/lib/chat-utils';
import { cn } from '@/lib/utils';

interface SessionSidebarProps {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  className?: string;
}

export function SessionSidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onClearAll,
  className,
}: SessionSidebarProps) {
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start gap-2" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Phiên chat mới
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="Danh sách phiên chat">
        <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Phiên có bộ nhớ ({sessions.length})
        </p>
        {sessions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Chưa có phiên nào. Gửi tin nhắn đầu tiên để tạo phiên.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {sessions.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(s.id);
                  }
                }}
                className={cn(
                  'group flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition-colors',
                  s.id === activeId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted/70',
                )}
              >
                <MessageSquare
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{s.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.messages.length} tin nhắn · {formatTimeAgo(s.updatedAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  aria-label={`Xóa phiên ${s.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="border-t p-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-xs text-muted-foreground"
              disabled={sessions.length === 0}
            >
              Xóa toàn bộ dữ liệu
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Xóa tất cả phiên chat?</AlertDialogTitle>
              <AlertDialogDescription>
                Toàn bộ lịch sử hội thoại lưu cục bộ trên trình duyệt này sẽ bị xóa vĩnh viễn. Hành
                động này không thể hoàn tác.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Hủy</AlertDialogCancel>
              <AlertDialogAction onClick={onClearAll}>Xóa hết</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
