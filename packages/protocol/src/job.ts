// packages/protocol — job.ts
// T1-a-1 FROZEN (Đợt 2): types + zod schemas cho job payload.
// KHÔNG import zsdk. KHÔNG I/O. Chỉ types + zod.
import { z } from 'zod';

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  // chỉ tồn tại khi preserved thinking (clear_thinking=false) — reserved theo D2
  reasoning_content: z.string().optional(),
});
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning_content?: string;
}

export const ReasoningBlockSchema = z.object({
  turn: z.number().int().nonnegative(),
  // NGUYÊN VĂN reasoning_content — cấm sửa/reorder/re-encode
  content: z.string(),
});
export interface ReasoningBlock {
  turn: number;
  content: string;
}

// F9: model là pass-through string tự do — KHÔNG enum (proxy có thể rewrite; môi trường khác nhau phục vụ model khác nhau)
export const JobPayloadSchema = z.object({
  job_id: z.string().min(1),
  request_id: z.string().min(1),
  tenant_id: z.string().min(1),          // D3: MVP = 'default' — reserved từ draft v1
  conversation_id: z.string().optional(),
  model: z.string().min(1),              // free string — KHÔNG validate theo response.model (F9)
  messages: z.array(ChatMessageSchema).min(1),
  thinking: z.object({ type: z.enum(['enabled', 'disabled']) }),
  clear_thinking: z.boolean().optional(),            // D2: MVP luôn true; false = preserved thinking (reserved)
  reasoning_blocks: z.array(ReasoningBlockSchema).optional(), // D2: RESERVED FIELD từ draft v1 — MVP luôn undefined
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});
export interface JobPayload {
  job_id: string;
  request_id: string;
  tenant_id: string;
  conversation_id?: string;
  model: string;
  messages: ChatMessage[];
  thinking: { type: 'enabled' | 'disabled' };
  clear_thinking?: boolean;
  reasoning_blocks?: ReasoningBlock[];
  max_tokens?: number;
  temperature?: number;
}

export const WorkerCapabilitiesSchema = z.object({
  worker_id: z.string().min(1),
  tenant_id: z.string().min(1),          // D3: worker gắn tenant từ lúc register
  models: z.array(z.string()).min(0),
  concurrency: z.number().int().positive(),
  protocol_version: z.number().int().positive(),
  version: z.string(),
});
export interface WorkerCapabilities {
  worker_id: string;
  tenant_id: string;
  models: string[];
  concurrency: number;
  protocol_version: number;
  version: string;
}

export type JobUsage = { prompt_tokens: number; completion_tokens: number };
