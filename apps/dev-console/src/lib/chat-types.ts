import type { EndpointMode } from './endpoints';

export type ChatRole = 'user' | 'assistant';

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'interrupted' | 'error';

/** Usage từ chunk cuối (tolerant: chunk.usage ?? choices[0].usage — log [v3]/T0-c). */
export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
}

export interface StreamMetrics {
  /** Time from request sent to first SSE byte received. */
  ttfbMs: number | null;
  /** Duration of the thinking phase (first reasoning delta -> first answer delta or end). */
  thinkingMs: number | null;
  /** Duration of the answering phase (first answer delta -> end). */
  answerMs: number | null;
  /** Total wall time from request sent to stream end. */
  totalMs: number | null;
  reasoningChars: number;
  answerChars: number;
  answerCharsPerSec: number | null;
  /** Số chunk `delta.reasoning_content` đã nhận. */
  reasoningChunks: number;
  /** Số chunk `delta.content` đã nhận. */
  answerChunks: number;
  /** Whether a finish_reason chunk was received before the stream ended. */
  sawFinish: boolean;
  /** Whether the [DONE] sentinel was received. */
  sawDone: boolean;
  eventCount: number;
  /** finish_reason từ chunk cuối ('stop'...) — null nếu stream không đạt finish. */
  finishReason: string | null;
  /** usage từ chunk cuối (nếu upstream gửi). */
  usage: UsageInfo | null;
  /** X-Job-Id từ response header (WebHub mode — T4-a debug panel). */
  jobId: string | null;
  /** X-Request-Id từ response header (WebHub mode — T4-a debug panel). */
  requestId: string | null;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Answer text (for user messages: the user's prompt). */
  content: string;
  /** Thinking / reasoning text (assistant only) — nối từ `delta.reasoning_content`. */
  reasoning: string;
  status: MessageStatus;
  /** Thinking mode đã được yêu cầu ở lượt này (F7: placeholder nếu upstream không trả reasoning). */
  thinkingRequested?: boolean;
  error?: string;
  metrics?: StreamMetrics;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type StreamPhase =
  | 'connecting'
  | 'thinking'
  | 'answering'
  | 'finalizing'
  | 'idle';

export interface LiveStreamStats {
  phase: Exclude<StreamPhase, 'idle'>;
  elapsedMs: number;
  ttfbMs: number | null;
  thinkingMs: number | null;
  reasoningChars: number;
  answerChars: number;
  charsPerSec: number | null;
  reasoningChunks: number;
  answerChunks: number;
  eventCount: number;
  jobId: string | null;
  requestId: string | null;
}

export interface EventLogEntry {
  id: number;
  offsetMs: number;
  name: string;
  bytes: number;
  preview: string;
}

/**
 * Events sau khi parse upstream-native SSE (wire F4):
 * - chunk `delta.reasoning_content` → thinking_delta
 * - chunk `delta.content` → answer_delta
 * - chunk `finish_reason` (+ usage tolerant) → finish
 * - frame `event: error` → error
 * - `data: [DONE]` → done
 * - response headers (X-Job-Id / X-Request-Id) → response_meta (1 lần sau khi fetch OK)
 */
export type StreamEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'answer_delta'; delta: string }
  | { type: 'finish'; reason: string; usage?: UsageInfo | null }
  | { type: 'error'; message: string }
  | { type: 'response_meta'; jobId: string | null; requestId: string | null }
  | { type: 'done' }
  | { type: 'stream_end' };
