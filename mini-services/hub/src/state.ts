// apps/webhub — state.ts (T3-d)
// MemoryStateStore: MVP dev — mất khi restart (chấp nhận). Key BẮT BUỘC prefix tenant (D3):
//   tenant:{tid}:conv:{cid}:messages
//   tenant:{tid}:conv:{cid}:reasoning
//   tenant:{tid}:job:{jid}
//   tenant:{tid}:queue   (queue giữ trong Dispatcher, cùng quy ước prefix)
// D2: interface PHẢI có getReasoning()/saveReasoning() ngay từ đầu — MemoryStateStore no-op (MVP).
// GIỚI HẠN ĐÃ BIẾT (open question cho owner): assistant answer text KHÔNG được lưu —
// hub byte-blind (F6) không thể trích answer từ raw SSE; user messages CÓ lưu;
// bộ nhớ hội thoại MVP dựa vào client gửi đủ history (OpenAI-style stateless).
// Owner sau này có thể cho worker kèm `answer_text` trong job.done — quyết định KHÔNG thuộc agent này.
import type { ChatMessage, ReasoningBlock } from '../protocol/index';

export type JobRecordStatus =
  | 'queued'
  | 'dispatched'
  | 'streaming'
  | 'done'
  | 'error'
  | 'cancelled';

export interface JobRecord {
  job_id: string;
  request_id: string;
  tenant_id: string;
  status: JobRecordStatus;
  created_at: number;
  updated_at: number;
  chunk_count?: number;
  finish_reason?: string;
  error_type?: string;
}

export interface StateStore {
  getMessages(tenantId: string, conversationId: string): Promise<ChatMessage[]>;
  appendMessages(tenantId: string, conversationId: string, msgs: ChatMessage[]): Promise<void>;
  // D2 — reserved cho preserved thinking; MVP no-op
  getReasoning(tenantId: string, conversationId: string): Promise<ReasoningBlock[]>;
  saveReasoning(tenantId: string, conversationId: string, block: ReasoningBlock): Promise<void>;
  getJob(tenantId: string, jobId: string): Promise<JobRecord | null>;
  saveJob(tenantId: string, job: JobRecord): Promise<void>;
}

export const stateKey = {
  messages: (t: string, c: string) => `tenant:${t}:conv:${c}:messages`,
  reasoning: (t: string, c: string) => `tenant:${t}:conv:${c}:reasoning`,
  job: (t: string, j: string) => `tenant:${t}:job:${j}`,
  queue: (t: string) => `tenant:${t}:queue`,
};

export class MemoryStateStore implements StateStore {
  private map = new Map<string, unknown>();

  async getMessages(tenantId: string, conversationId: string): Promise<ChatMessage[]> {
    const v = this.map.get(stateKey.messages(tenantId, conversationId));
    return v ? [...(v as ChatMessage[])] : [];
  }

  async appendMessages(
    tenantId: string,
    conversationId: string,
    msgs: ChatMessage[],
  ): Promise<void> {
    if (msgs.length === 0) return;
    const key = stateKey.messages(tenantId, conversationId);
    const existing = (this.map.get(key) as ChatMessage[] | undefined) ?? [];
    this.map.set(key, [...existing, ...msgs]);
  }

  // D2: no-op trong MVP (luôn trả []) — interface giữ nguyên cho preserved thinking sau này.
  async getReasoning(_tenantId: string, _conversationId: string): Promise<ReasoningBlock[]> {
    return [];
  }

  // D2: no-op trong MVP.
  async saveReasoning(
    _tenantId: string,
    _conversationId: string,
    _block: ReasoningBlock,
  ): Promise<void> {
    /* no-op per D2 — MemoryStateStore MVP */
  }

  async getJob(tenantId: string, jobId: string): Promise<JobRecord | null> {
    return (this.map.get(stateKey.job(tenantId, jobId)) as JobRecord | undefined) ?? null;
  }

  async saveJob(tenantId: string, job: JobRecord): Promise<void> {
    this.map.set(stateKey.job(tenantId, job.job_id), { ...job, updated_at: Date.now() });
  }
}
