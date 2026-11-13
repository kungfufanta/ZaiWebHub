export type ChatRole = 'user' | 'assistant';

export type MessageStatus = 'streaming' | 'done' | 'stopped' | 'interrupted' | 'error';

export interface StreamMetrics {
  /** Time from request sent to first SSE byte received. */
  ttfbMs: number | null;
  /** Duration of the thinking phase (thinking_start -> answer_start or end). */
  thinkingMs: number | null;
  /** Duration of the answering phase (answer_start -> end). */
  answerMs: number | null;
  /** Total wall time from request sent to stream end. */
  totalMs: number | null;
  reasoningChars: number;
  answerChars: number;
  answerCharsPerSec: number | null;
  /** Whether a finish event was received before the stream ended. */
  sawFinish: boolean;
  /** Whether the [DONE] sentinel was received. */
  sawDone: boolean;
  eventCount: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** Answer text (for user messages: the user's prompt). */
  content: string;
  /** Thinking / reasoning text (assistant only). */
  reasoning: string;
  status: MessageStatus;
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
  eventCount: number;
}

export interface EventLogEntry {
  id: number;
  offsetMs: number;
  name: string;
  bytes: number;
  preview: string;
}

export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'answer_start' }
  | { type: 'answer_delta'; delta: string }
  | { type: 'finish'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'stream_end' };
