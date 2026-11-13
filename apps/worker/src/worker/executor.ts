// apps/worker — src/worker/executor.ts (T2-b)
// Job executor: job.dispatch → job.ack đã gửi ở ws-client → streamChat() của zai-adapter →
// mỗi chunk: (1) WS BINARY frame encodeChunkFrame(job_id, seq, chunk) — bytes NGUYÊN XI (F4);
//            (2) scanner.feed(chunk) song song (F6) — scanner CHỈ đọc finish_reason/usage/[DONE].
// Backpressure BẮT BUỘC nằm ở io.sendBinary (ws.bufferedAmount > 1MB → chờ < 256KB — PLAN T2-b).
// Worker STATELESS: hết job thì quên hết; không auto-retry (hub owns at-most-once).
import {
  createSseMetadataScanner,
  encodeChunkFrame,
  type JobPayload,
  type WorkerToHub,
} from '@zaiwebhub/protocol';
import { streamChat } from '@zaiwebhub/zai-adapter';
import { errMsg, log, sanitizeErrorMessage } from './util';

/** Envelope F4 cần job_id là UUID (16 bytes) — kiểm tra trước khi stream, fail fast. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface JobIo {
  /** Gửi JSON control frame (đã validate WorkerToHubSchema ở ws-client). */
  sendControl: (frame: WorkerToHub) => void;
  /** Gửi WS BINARY frame — áp backpressure bufferedAmount. Trả false nếu socket không còn mở. */
  sendBinary: (payload: Uint8Array) => Promise<boolean>;
  isOpen: () => boolean;
}

export interface JobHandle {
  job_id: string;
  controller: AbortController;
  done: Promise<void>;
}

export function startJob(job: JobPayload, io: JobIo): JobHandle {
  const controller = new AbortController();
  const done = runJob(job, io, controller);
  return { job_id: job.job_id, controller, done: done.catch(() => {}) };
}

async function runJob(job: JobPayload, io: JobIo, controller: AbortController): Promise<void> {
  const { job_id, request_id } = job;
  const logCtx = { job_id, request_id };
  const logJob = (
    level: 'info' | 'warn' | 'error',
    msg: string,
    extra?: Record<string, unknown>,
  ): void => log(level, msg, { ...logCtx, ...extra });

  // ---- MODE=relay (T4-d) — TODO stub, KHÔNG implement ở đợt này ----
  if (process.env.MODE === 'relay') {
    // TODO(T4-d): MODE=relay — KHÔNG gọi zsdk/adapter; chỉ forward nguyên byte payload chunk
    // giữa sandbox và hub (cùng WS protocol, env RELAY_TARGET nếu cần).
    logJob('warn', 'MODE=relay is a stub (T4-d not implemented yet) — rejecting job with job.error');
    io.sendControl({
      type: 'job.error',
      job_id,
      error: { message: 'relay mode not implemented (planned T4-d)', type: 'unknown' },
    });
    return;
  }

  if (!UUID_RE.test(job_id)) {
    // Hub sinh job_id = uuid (protocol JobPayload) — nếu không phải UUID thì envelope F4 không encode được.
    logJob('error', 'job_id is not a UUID — cannot build job.chunk binary envelope (F4)');
    io.sendControl({
      type: 'job.error',
      job_id,
      error: { message: 'job_id must be a UUID to encode job.chunk envelope', type: 'unknown' },
    });
    return;
  }

  const scanner = createSseMetadataScanner();
  let seq = 0;

  logJob('info', 'job executing — calling zai-adapter streamChat', {
    model: job.model,
    thinking: job.thinking.type,
    message_count: job.messages.length,
    upstream: process.env.UPSTREAM ?? 'proxy',
  });

  const stream = streamChat(
    {
      messages: job.messages,
      model: job.model,
      thinking: job.thinking,
      clear_thinking: job.clear_thinking,
      max_tokens: job.max_tokens,
      temperature: job.temperature,
    },
    { signal: controller.signal },
  );

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (controller.signal.aborted) break; // job.cancel → ngừng ngay, không gửi thêm byte
      if (!io.isOpen()) {
        logJob('warn', 'WS closed mid-job — dropping remaining stream (hub owns at-most-once)');
        return;
      }
      if (done) break;
      if (value && value.byteLength > 0) {
        scanner.feed(value); // F6: metadata-only scan — bytes vẫn đi ra NGUYÊN XI bên dưới (tee song song)
        const frame = encodeChunkFrame(job_id, seq, value);
        const sent = await io.sendBinary(frame);
        if (!sent) {
          logJob('warn', 'binary send failed — dropping remaining stream (no auto-retry)');
          return;
        }
        seq += 1;
      }
    }

    if (controller.signal.aborted) {
      io.sendControl({
        type: 'job.error',
        job_id,
        error: { message: 'cancelled', type: 'cancelled' },
      });
      logJob('info', 'job ended: cancelled', { chunks_sent: seq });
      return;
    }

    const r = scanner.result();
    if (r.done || r.finish_reason) {
      const usage = r.usage
        ? {
            prompt_tokens: r.usage.prompt_tokens,
            completion_tokens: r.usage.completion_tokens,
          }
        : undefined;
      io.sendControl({
        type: 'job.done',
        job_id,
        finish_reason: r.finish_reason ?? 'stop',
        usage,
        // F6 mở rộng: scanner biết chắc [DONE] đã relay trong chunk bytes → hub không flush thêm
        upstream_done_relayed: r.done,
      });
      logJob('info', 'job ended: done', {
        finish_reason: r.finish_reason ?? 'stop',
        usage,
        chunks_sent: seq,
        scan_done: r.done,
        upstream_done_relayed_sent: r.done,
      });
    } else {
      io.sendControl({
        type: 'job.error',
        job_id,
        error: { message: 'stream ended without finish', type: 'unknown' },
      });
      logJob('warn', 'job ended: stream closed without [DONE]/finish_reason', { chunks_sent: seq });
    }
  } catch (err) {
    // streamChat theo contract không throw; phòng trường hợp lỗi bất ngờ — luôn kết thúc bằng 1 terminal frame.
    if (controller.signal.aborted) {
      io.sendControl({
        type: 'job.error',
        job_id,
        error: { message: 'cancelled', type: 'cancelled' },
      });
      logJob('info', 'job ended: cancelled (reader threw)', { chunks_sent: seq });
    } else {
      const message = sanitizeErrorMessage(errMsg(err));
      io.sendControl({
        type: 'job.error',
        job_id,
        error: { message, type: 'upstream_error' },
      });
      logJob('error', 'job ended: upstream error', { error: message, chunks_sent: seq });
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // stream đã đóng — bỏ qua
    }
  }
}
