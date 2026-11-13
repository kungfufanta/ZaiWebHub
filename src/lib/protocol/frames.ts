// packages/protocol — frames.ts
// T1-a-1 FROZEN (Đợt 2): WS control frames (JSON text, zod validate 2 đầu) +
// binary envelope codec cho job.chunk (F4: raw SSE bytes nguyên xi).
// KHÔNG import zsdk. KHÔNG I/O.
import { z } from 'zod';
import type { JobPayload, WorkerCapabilities, JobUsage } from './job';
import { JobPayloadSchema, WorkerCapabilitiesSchema } from './job';

// ---------- Hub → Worker (JSON TEXT frames) ----------
export const JobDispatchFrameSchema = z.object({
  type: z.literal('job.dispatch'),
  job: JobPayloadSchema,
});
export const JobCancelFrameSchema = z.object({
  type: z.literal('job.cancel'),
  job_id: z.string().min(1),
  reason: z.string().optional(),
});
export const WorkerPingFrameSchema = z.object({
  type: z.literal('worker.ping'),
  ts: z.number(),
});

export const HubToWorkerSchema = z.discriminatedUnion('type', [
  JobDispatchFrameSchema,
  JobCancelFrameSchema,
  WorkerPingFrameSchema,
]);

export type JobDispatchFrame = { type: 'job.dispatch'; job: JobPayload };
export type JobCancelFrame = { type: 'job.cancel'; job_id: string; reason?: string };
export type WorkerPingFrame = { type: 'worker.ping'; ts: number };
export type HubToWorker = JobDispatchFrame | JobCancelFrame | WorkerPingFrame;

// ---------- Worker → Hub (JSON TEXT frames — CHỈ control; stream data đi binary riêng) ----------
export const WorkerRegisterFrameSchema = z.object({
  type: z.literal('worker.register'),
  capabilities: WorkerCapabilitiesSchema,
  token: z.string().min(1),
});
export const WorkerHeartbeatFrameSchema = z.object({
  type: z.literal('worker.heartbeat'),
  ts: z.number(),
  inflight: z.number().int().nonnegative(),
});
export const JobAckFrameSchema = z.object({
  type: z.literal('job.ack'),
  job_id: z.string().min(1),
});
// job.chunk KHÔNG nằm ở đây — là WS BINARY frame theo envelope F4 (xem encode/decode bên dưới)
export const JobDoneFrameSchema = z.object({
  type: z.literal('job.done'),
  job_id: z.string().min(1),
  finish_reason: z.string().min(1),
  usage: z
    .object({ prompt_tokens: z.number().int(), completion_tokens: z.number().int() })
    .optional(),
  // F6 mở rộng (Đợt 3 integration): true = worker đã relay dòng `data: [DONE]` của upstream
  // trong chunk bytes → hub KHÔNG flush thêm [DONE] (tránh trùng lặp). Bỏ qua → hub flush defensively.
  upstream_done_relayed: z.boolean().optional(),
});
export const JobErrorFrameSchema = z.object({
  type: z.literal('job.error'),
  job_id: z.string().min(1),
  error: z.object({
    message: z.string(),
    type: z.enum(['upstream_error', 'cancelled', 'timeout', 'quota', 'unknown']),
  }),
});

export const WorkerToHubSchema = z.discriminatedUnion('type', [
  WorkerRegisterFrameSchema,
  WorkerHeartbeatFrameSchema,
  JobAckFrameSchema,
  JobDoneFrameSchema,
  JobErrorFrameSchema,
]);

export type WorkerRegisterFrame = {
  type: 'worker.register';
  capabilities: WorkerCapabilities;
  token: string;
};
export type WorkerHeartbeatFrame = { type: 'worker.heartbeat'; ts: number; inflight: number };
export type JobAckFrame = { type: 'job.ack'; job_id: string };
export type JobDoneFrame = {
  type: 'job.done';
  job_id: string;
  finish_reason: string;
  usage?: JobUsage;
  upstream_done_relayed?: boolean;
};
export type JobErrorFrame = {
  type: 'job.error';
  job_id: string;
  error: { message: string; type: 'upstream_error' | 'cancelled' | 'timeout' | 'quota' | 'unknown' };
};
export type WorkerToHub =
  | WorkerRegisterFrame
  | WorkerHeartbeatFrame
  | JobAckFrame
  | JobDoneFrame
  | JobErrorFrame;

// ---------- Binary envelope cho job.chunk (F4 Đợt 2) ----------
// Layout: [16B job_id (uuid bytes)][4B seq (uint32 big-endian)][payload = raw SSE bytes NGUYÊN XI]
export const CHUNK_HEADER_SIZE = 20; // 16 + 4

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes.slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function encodeChunkFrame(jobId: string, seq: number, payload: Uint8Array): Uint8Array {
  if (seq < 0 || seq > 0xffffffff) throw new Error(`seq out of range: ${seq}`);
  const out = new Uint8Array(CHUNK_HEADER_SIZE + payload.length);
  out.set(uuidToBytes(jobId), 0);
  const view = new DataView(out.buffer);
  view.setUint32(16, seq, false); // big-endian
  out.set(payload, CHUNK_HEADER_SIZE);
  return out;
}

export function decodeChunkFrame(
  frame: Uint8Array,
): { jobId: string; seq: number; payload: Uint8Array } {
  if (frame.length < CHUNK_HEADER_SIZE) throw new Error('chunk frame too short');
  const jobId = bytesToUuid(frame.slice(0, 16));
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const seq = view.getUint32(16, false); // big-endian
  const payload = frame.slice(CHUNK_HEADER_SIZE);
  return { jobId, seq, payload };
}
