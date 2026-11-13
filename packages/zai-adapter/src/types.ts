// packages/zai-adapter — types.ts (T1-b)
// Types nền (ChatMessage, ReasoningBlock) là FROZEN contract từ @zaiwebhub/protocol — adapter chỉ định nghĩa
// request/options riêng. KHÔNG enum model (F9: response.model có thể bị proxy rewrite — chỉ log, không validate).
import type { ChatMessage } from '@zaiwebhub/protocol';

export interface ChatRequest {
  messages: ChatMessage[];
  /** Pass-through tự do (G2-3: proxy rewrite model) — mặc định DEFAULT_MODEL. */
  model?: string;
  /** Mặc định { type: 'enabled' }. 'disabled' → chỉ gửi field đó cho upstream (README rule 6). */
  thinking?: { type: 'enabled' | 'disabled' };
  /** false = preserved thinking (D2, reserved — MVP luôn true). */
  clear_thinking?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface StreamChatOptions {
  /** Abort giữa stream → reader.cancel() + đóng sạch, KHÔNG ghi thêm byte nào (README rule 4). */
  signal?: AbortSignal;
}

/** F8: cấu hình upstream — proxy (sandbox, /etc/.z-ai-config) | real (VPS: ZAI_API_KEY + ZAI_BASE_URL). */
export type UpstreamMode = 'proxy' | 'real';

/** Default REQUEST model field. response.model có thể bị rewrite (G2-3) — không bao giờ validate theo nó (F9). */
export const DEFAULT_MODEL = 'glm-5.3' as const;
