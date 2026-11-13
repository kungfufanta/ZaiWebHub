import type { ChatMessage, ChatSession } from './chat-types';

export const MODEL_OPTIONS = ['glm-5.3', 'glm-4.7', 'glm-4.6', 'glm-4-plus'] as const;

export const SAMPLE_PROMPTS = [
  {
    title: 'Brainstorm app AI',
    text: 'Tôi muốn xây dựng một app AI giúp sinh viên ôn thi hiệu quả hơn. Hãy phân tích ý tưởng: mục tiêu người dùng, 5 tính năng cốt lõi, mô hình kinh doanh, rủi ro chính và lộ trình MVP 3 tháng.',
  },
  {
    title: 'Trade-off kiến trúc',
    text: 'So sánh monolith và microservices cho một startup 5 người. Phân tích chi phí vận hành, tốc độ phát triển, khả năng mở rộng, rồi chốt bằng bảng trade-off và một khuyến nghị rõ ràng.',
  },
  {
    title: 'Câu đố logic',
    text: 'Có 3 chiếc hộp dán nhãn "Táo", "Cam", "Táo + Cam" nhưng tất cả nhãn đều sai. Chỉ được mở đúng một hộp và lấy một quả ra xem. Hãy suy luận từng bước để xác định cách dán lại nhãn đúng.',
  },
] as const;

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('vi-VN');
}

export function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'vừa xong';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createMessage(
  init: Partial<ChatMessage> & { role: ChatMessage['role'] },
): ChatMessage {
  return {
    id: generateId(),
    role: init.role,
    content: init.content ?? '',
    reasoning: init.reasoning ?? '',
    status: init.status ?? 'done',
    createdAt: init.createdAt ?? Date.now(),
    ...(init.error !== undefined ? { error: init.error } : {}),
    ...(init.metrics !== undefined ? { metrics: init.metrics } : {}),
  };
}

export function createSession(title: string = 'Phiên chat mới'): ChatSession {
  const now = Date.now();
  return { id: generateId(), title, createdAt: now, updatedAt: now, messages: [] };
}

/**
 * Builds the message history sent to the model (the chat "memory").
 * User messages are always kept; assistant messages are kept when they
 * produced answer content and finished cleanly (done) or were stopped
 * manually with partial content (stopped). Failed/empty turns are dropped
 * so a broken stream does not poison the context.
 */
export function buildHistory(
  messages: ChatMessage[],
  maxMessages: number,
  systemPrompt: string,
): { role: string; content: string }[] {
  const usable = messages.filter((m) => {
    if (m.role === 'user') return m.content.trim().length > 0;
    return (
      m.role === 'assistant' &&
      m.content.trim().length > 0 &&
      (m.status === 'done' || m.status === 'stopped')
    );
  });
  // Ghi chú: role là string rộng (system/user/assistant) — không suy inferred ChatRole
  // từ map phía trên, nếu không unshift({role:'system'}) bị TS2322.
  const history: { role: string; content: string }[] = usable
    .slice(-maxMessages)
    .map((m) => ({ role: m.role, content: m.content }));
  const system = systemPrompt.trim();
  if (system) history.unshift({ role: 'system', content: system });
  return history;
}
