// apps/webhub — dispatch.ts (T3-b)
// Dispatcher: DIRECT PUSH khi có worker rảnh + queue overflow (in-memory, key theo tenant D3)
// + visibility timeout 30s (job.ack phải tới trong 30s sau job.dispatch) + at-most-once:
//   - ĐÃ nhận job.chunk đầu tiên → KHÔNG BAO GIỜ re-dispatch.
//   - Lỗi trước chunk đầu → requeue, tối đa 1 re-dispatch tổng; lần 2 fail → event:error cho user.
// Hub BYTE-BLIND (F6): chunk bytes đẩy thẳng vào SSE response KHÔNG parse; kết thúc chỉ từ job.done/job.error.
import {
  SSE_DONE,
  SSE_ERROR_EVENT,
  buildSseErrorFrame,
  type JobPayload,
  type JobUsage,
  type SseErrorType,
} from './protocol/index';
import type { WorkerHub, WorkerEntry } from './hub/ws';
import { log } from './logger';
import type { JobRecord, JobRecordStatus, StateStore } from './state';
import { stateKey } from './state';

const ACK_TIMEOUT_MS = 30_000; // visibility timeout (T3-b)
const MAX_REDISPATCH = 1; // tối đa 1 re-dispatch tổng (2 attempt) trước khi báo lỗi cho user

const DONE_BYTES = new TextEncoder().encode(`data: ${SSE_DONE}\n\n`);

type JobStatus = 'queued' | 'dispatched' | 'streaming' | 'done' | 'error' | 'cancelled';

interface JobRuntime {
  job: JobPayload;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  status: JobStatus;
  acked: boolean;
  chunkCount: number;
  assignedWorkerId: string | null;
  redispatchCount: number;
  visibilityTimer: NodeJS.Timeout | null;
  settled: boolean; // SSE response đã kết thúc — bỏ qua mọi frame muộn
  cancelled: boolean; // user đã disconnect
  createdAt: number;
}

export interface DispatcherDeps {
  hub: WorkerHub;
  store: StateStore;
}

export class Dispatcher {
  private jobs = new Map<string, JobRuntime>(); // key: job_id
  private queues = new Map<string, JobRuntime[]>(); // key: tenant_id (tương ứng tenant:{tid}:queue)

  constructor(private deps: DispatcherDeps) {}

  // ---------- gọi từ api/chat.ts ----------

  // Trả SSE stream cho user; submitJob được gọi NGAY SAU khi Response object đã dựng
  // (headers đã chốt trước khi biết worker nào nhận job).
  submitJob(job: JobPayload, controller: ReadableStreamDefaultController<Uint8Array> | null): void {
    const rt: JobRuntime = {
      job,
      controller,
      status: 'queued',
      acked: false,
      chunkCount: 0,
      assignedWorkerId: null,
      redispatchCount: 0,
      visibilityTimer: null,
      settled: false,
      cancelled: false,
      createdAt: Date.now(),
    };
    this.jobs.set(job.job_id, rt);
    void this.persist(rt);
    const dispatched = this.tryDispatch(rt);
    if (!dispatched) {
      this.enqueue(rt);
    }
  }

  // User disconnect (T3-c): trước chunk đầu → hủy job khỏi queue/dispatch (dọn dẹp sạch);
  // đang stream → gửi job.cancel cho worker rồi đóng sạch (KHÔNG flush [DONE] — bytes upstream
  // đã relay nguyên xi, flushing thêm sẽ tạo [DONE] trùng khi disconnect xảy ra SAU khi client
  // đã nhận đủ bytes; socket đóng rồi thì flush cũng vô nghĩa — F4 wire sạch được ưu tiên).
  onUserDisconnect(jobId: string): void {
    const rt = this.jobs.get(jobId);
    if (!rt || rt.settled) return;
    log('info', 'user disconnected — cancelling job', {
      job_id: jobId,
      request_id: rt.job.request_id,
      chunk_count: rt.chunkCount,
    });
    rt.cancelled = true;
    this.clearVisibilityTimer(rt);
    if (rt.chunkCount === 0) {
      this.removeFromQueue(rt);
      if (rt.assignedWorkerId) {
        this.deps.hub.sendToWorker(rt.assignedWorkerId, {
          type: 'job.cancel',
          job_id: jobId,
          reason: 'user disconnected',
        });
      }
      rt.status = 'cancelled';
      this.jobs.delete(jobId);
      void this.persist(rt);
    } else {
      // đang stream — at-most-once: chỉ cancel worker, không re-dispatch
      if (rt.assignedWorkerId) {
        this.deps.hub.sendToWorker(rt.assignedWorkerId, {
          type: 'job.cancel',
          job_id: jobId,
          reason: 'user disconnected',
        });
      }
      rt.status = 'cancelled';
      this.settle(rt); // không flush [DONE] — xem comment ở đầu method (F4 wire sạch)
    }
  }

  // ---------- gọi từ hub/ws.ts hooks ----------

  onWorkerRegistered(_entry: WorkerEntry): void {
    this.drainTenant(_entry.tenant_id);
  }

  onHeartbeat(entry: WorkerEntry, inflight: number): void {
    // inflight đã set authoritative trong ws.ts; nếu worker nhả slot → thử drain queue
    if (inflight < entry.capabilities.concurrency) {
      this.drainTenant(entry.tenant_id);
    }
  }

  onWorkerRemoved(entry: WorkerEntry): void {
    // worker chết: mọi job in-flight trên worker đó xử lý theo at-most-once
    for (const rt of [...this.jobs.values()]) {
      if (rt.assignedWorkerId !== entry.worker_id || rt.settled) continue;
      if (rt.chunkCount === 0) {
        log('warn', 'worker died before stream — requeueing job', {
          job_id: rt.job.job_id,
          request_id: rt.job.request_id,
          worker_id: entry.worker_id,
        });
        rt.assignedWorkerId = null;
        rt.acked = false;
        this.clearVisibilityTimer(rt);
        rt.status = 'queued';
        this.requeueOrExit(rt, 'worker died before stream');
      } else {
        log('warn', 'worker died midstream — no re-dispatch (at-most-once)', {
          job_id: rt.job.job_id,
          request_id: rt.job.request_id,
          worker_id: entry.worker_id,
          chunk_count: rt.chunkCount,
        });
        rt.status = 'error';
        this.settle(
          rt,
          concatBytes(
            buildSseErrorFrame('upstream connection lost (worker died midstream)', 'upstream_error'),
            DONE_BYTES,
          ),
        );
      }
    }
  }

  onAck(workerId: string, jobId: string): void {
    const rt = this.jobs.get(jobId);
    if (!rt) {
      log('warn', 'job.ack for unknown job', { worker_id: workerId, job_id: jobId });
      return;
    }
    if (rt.assignedWorkerId && rt.assignedWorkerId !== workerId) {
      log('warn', 'job.ack from non-assigned worker — ignored', {
        worker_id: workerId,
        job_id: jobId,
        request_id: rt.job.request_id,
      });
      return;
    }
    if (rt.acked) return;
    rt.acked = true;
    rt.status = 'dispatched';
    this.clearVisibilityTimer(rt);
    log('info', 'job acked', {
      job_id: jobId,
      request_id: rt.job.request_id,
      worker_id: workerId,
    });
  }

  onChunk(workerId: string, jobId: string, seq: number, payload: Uint8Array): void {
    const rt = this.jobs.get(jobId);
    if (!rt) {
      log('warn', 'chunk for unknown job — dropped', {
        worker_id: workerId,
        job_id: jobId,
        seq,
      });
      return;
    }
    if (rt.settled || rt.cancelled) return; // frame muộn sau khi stream đã kết thúc/hủy
    if (rt.assignedWorkerId && rt.assignedWorkerId !== workerId) {
      log('warn', 'chunk from non-assigned worker — dropped', {
        worker_id: workerId,
        job_id: jobId,
        seq,
        request_id: rt.job.request_id,
      });
      return;
    }
    if (rt.chunkCount === 0) {
      // CHUNK ĐẦU TIÊN → mark streaming: từ đây KHÔNG BAO GIỜ re-dispatch (at-most-once, T3-b)
      rt.status = 'streaming';
      rt.acked = true; // chunk cũng ngầm xác nhận worker đã nhận job
      this.clearVisibilityTimer(rt);
      log('info', 'first chunk received — streaming', {
        job_id: jobId,
        request_id: rt.job.request_id,
        worker_id: workerId,
        ttfb_ms: Date.now() - rt.createdAt,
      });
    }
    rt.chunkCount += 1;
    this.safeEnqueue(rt, payload); // raw bytes NGUYÊN XI — không parse, không re-stringify (F4/F6)
  }

  onDone(
    workerId: string,
    jobId: string,
    finishReason: string,
    usage?: JobUsage,
    upstreamDoneRelayed?: boolean,
  ): void {
    this.releaseWorker(workerId);
    const rt = this.jobs.get(jobId);
    if (!rt) {
      log('warn', 'job.done for unknown job', { worker_id: workerId, job_id: jobId });
      return;
    }
    if (rt.settled) return;
    log('info', 'job done', {
      job_id: jobId,
      request_id: rt.job.request_id,
      worker_id: workerId,
      finish_reason: finishReason,
      usage,
      chunk_count: rt.chunkCount,
      duration_ms: Date.now() - rt.createdAt,
      upstream_done_relayed: upstreamDoneRelayed === true ? true : upstreamDoneRelayed,
    });
    rt.status = 'done';
    this.clearVisibilityTimer(rt);
    void this.persist(rt, { finish_reason: finishReason });
    // F6 + flag `upstream_done_relayed` (Đợt 3 integration): worker scan metadata biết chắc
    // dòng `data: [DONE]` của upstream đã nằm trong chunk bytes relayed hay chưa.
    // - true → KHÔNG flush thêm (tránh trùng [DONE] trên wire pass-through).
    // - undefined/false → flush defensively `data: [DONE]\n\n` để client LUÔN kết thúc sạch.
    if (upstreamDoneRelayed === true) {
      this.settle(rt);
    } else {
      this.settle(rt, DONE_BYTES);
    }
  }

  onError(workerId: string, jobId: string, error: { message: string; type: string }): void {
    this.releaseWorker(workerId);
    const rt = this.jobs.get(jobId);
    if (!rt) {
      log('warn', 'job.error for unknown job', {
        worker_id: workerId,
        job_id: jobId,
        error_type: error.type,
      });
      return;
    }
    if (rt.settled) return;
    if (rt.cancelled) {
      // worker xác nhận cancel (user đã gone) — dọn dẹp im lặng
      this.clearVisibilityTimer(rt);
      rt.settled = true;
      rt.status = 'cancelled';
      this.jobs.delete(jobId);
      void this.persist(rt);
      return;
    }
    log('warn', 'job error', {
      job_id: jobId,
      request_id: rt.job.request_id,
      worker_id: workerId,
      error_type: error.type,
      error_event: SSE_ERROR_EVENT,
      chunk_count: rt.chunkCount,
    });
    this.clearVisibilityTimer(rt);
    if (rt.chunkCount === 0) {
      // lỗi TRƯỚC chunk đầu → được phép retry (max 1 re-dispatch tổng); ưu tiên worker khác
      rt.assignedWorkerId = null;
      rt.acked = false;
      rt.status = 'queued';
      this.requeueOrExit(rt, `worker error before stream: ${error.type}`, workerId);
    } else {
      // lỗi SAU chunk → event:error + [DONE] rồi đóng sạch (không retry — at-most-once)
      rt.status = 'error';
      void this.persist(rt, { error_type: error.type });
      this.settle(
        rt,
        concatBytes(
          buildSseErrorFrame(error.message, error.type as SseErrorType),
          DONE_BYTES,
        ),
      );
    }
  }

  // ---------- internals ----------

  private enqueue(rt: JobRuntime): void {
    const key = rt.job.tenant_id;
    const q = this.queues.get(key) ?? [];
    q.push(rt);
    this.queues.set(key, q);
    rt.status = 'queued';
    log('info', 'job queued (no idle worker)', {
      job_id: rt.job.job_id,
      request_id: rt.job.request_id,
      tenant_id: key,
      queue_key: stateKey.queue(key),
      queue_len: q.length,
    });
  }

  private removeFromQueue(rt: JobRuntime): void {
    const q = this.queues.get(rt.job.tenant_id);
    if (!q) return;
    const idx = q.indexOf(rt);
    if (idx >= 0) q.splice(idx, 1);
  }

  private pickIdleWorker(tenantId: string, excludeWorkerId?: string): WorkerEntry | null {
    let best: WorkerEntry | null = null;
    for (const w of this.deps.hub.registry.values()) {
      if (w.tenant_id !== tenantId) continue;
      if (excludeWorkerId && w.worker_id === excludeWorkerId) continue;
      if (!this.deps.hub.isOpen(w)) continue;
      if (w.inflight >= w.capabilities.concurrency) continue;
      if (!best || w.inflight < best.inflight) best = w;
    }
    return best;
  }

  private tryDispatch(rt: JobRuntime, excludeWorkerId?: string): boolean {
    const worker = this.pickIdleWorker(rt.job.tenant_id, excludeWorkerId);
    if (!worker) return false;
    return this.dispatchToWorker(rt, worker);
  }

  private dispatchToWorker(rt: JobRuntime, worker: WorkerEntry): boolean {
    const sent = this.deps.hub.sendToWorker(worker.worker_id, {
      type: 'job.dispatch',
      job: rt.job,
    });
    if (!sent) return false;
    rt.status = 'dispatched';
    rt.acked = false;
    rt.assignedWorkerId = worker.worker_id;
    worker.inflight += 1;
    this.startVisibilityTimer(rt);
    log('info', 'job.dispatch sent (direct push)', {
      job_id: rt.job.job_id,
      request_id: rt.job.request_id,
      tenant_id: rt.job.tenant_id,
      worker_id: worker.worker_id,
      attempt: rt.redispatchCount + 1,
    });
    return true;
  }

  private startVisibilityTimer(rt: JobRuntime): void {
    this.clearVisibilityTimer(rt);
    rt.visibilityTimer = setTimeout(() => this.onAckTimeout(rt), ACK_TIMEOUT_MS);
    rt.visibilityTimer.unref?.();
  }

  private clearVisibilityTimer(rt: JobRuntime): void {
    if (rt.visibilityTimer) {
      clearTimeout(rt.visibilityTimer);
      rt.visibilityTimer = null;
    }
  }

  private onAckTimeout(rt: JobRuntime): void {
    if (rt.settled || rt.cancelled || rt.acked || rt.chunkCount > 0) return;
    const workerId = rt.assignedWorkerId;
    log('warn', 'visibility timeout — no job.ack within 30s', {
      job_id: rt.job.job_id,
      request_id: rt.job.request_id,
      worker_id: workerId,
    });
    // trả slot cho worker (nếu còn sống) rồi requeue cho worker khác
    if (workerId) this.releaseWorker(workerId, workerId === rt.assignedWorkerId ? rt.job.job_id : undefined);
    rt.assignedWorkerId = null;
    rt.acked = false;
    rt.status = 'queued';
    this.requeueOrExit(rt, 'ack timeout', workerId ?? undefined);
  }

  // re-dispatch hoặc fail ra user (max 1 re-dispatch tổng — T3-b).
  // Ưu tiên worker KHÁC excludeWorkerId (spec: "requeue cho worker khác"); nếu không còn
  // worker rảnh nào khác → cho phép worker cũ (đỡ treo user vô hạn với pool 1 worker);
  // không có worker nào → về queue chờ drain.
  private requeueOrExit(rt: JobRuntime, reason: string, excludeWorkerId?: string): void {
    if (rt.redispatchCount < MAX_REDISPATCH) {
      rt.redispatchCount += 1;
      let dispatched = this.tryDispatch(rt, excludeWorkerId);
      if (!dispatched && excludeWorkerId) dispatched = this.tryDispatch(rt);
      if (dispatched) {
        log('info', 'job re-dispatched', {
          job_id: rt.job.job_id,
          request_id: rt.job.request_id,
          reason,
          attempt: rt.redispatchCount + 1,
        });
        return;
      }
      this.enqueue(rt);
      return;
    }
    this.failJob(
      rt,
      'job failed before any output (no chunk delivered after retry)',
      'unknown',
    );
  }

  private failJob(rt: JobRuntime, message: string, type: SseErrorType): void {
    log('error', 'job failed — sending error frame to user', {
      job_id: rt.job.job_id,
      request_id: rt.job.request_id,
      error_type: type,
    });
    rt.status = 'error';
    void this.persist(rt, { error_type: type });
    this.settle(rt, concatBytes(buildSseErrorFrame(message, type), DONE_BYTES));
  }

  private releaseWorker(workerId: string, jobId?: string): void {
    const worker = this.deps.hub.registry.get(workerId);
    if (worker && worker.inflight > 0) worker.inflight -= 1;
    if (worker) this.drainTenant(worker.tenant_id);
    if (jobId) {
      log('info', 'worker slot released', { worker_id: workerId, job_id: jobId });
    }
  }

  private drainTenant(tenantId: string): void {
    const q = this.queues.get(tenantId);
    if (!q || q.length === 0) return;
    let guard = q.length + 5; // chống vòng lặp vô hạn
    while (q.length > 0 && guard-- > 0) {
      const rt = q[0];
      if (!rt || rt.settled || rt.cancelled) {
        q.shift();
        continue;
      }
      const worker = this.pickIdleWorker(tenantId);
      if (!worker) break;
      q.shift();
      rt.status = 'queued';
      this.dispatchToWorker(rt, worker);
    }
    if (q.length === 0) this.queues.delete(tenantId);
  }

  private safeEnqueue(rt: JobRuntime, bytes: Uint8Array): void {
    if (!rt.controller) return;
    try {
      rt.controller.enqueue(bytes);
    } catch {
      // client đã đóng stream — coi như disconnect giữa chừng
      log('warn', 'enqueue failed — client stream closed', {
        job_id: rt.job.job_id,
        request_id: rt.job.request_id,
        chunk_count: rt.chunkCount,
      });
      if (!rt.cancelled) {
        rt.cancelled = true;
        if (rt.assignedWorkerId) {
          this.deps.hub.sendToWorker(rt.assignedWorkerId, {
            type: 'job.cancel',
            job_id: rt.job.job_id,
            reason: 'user disconnected',
          });
        }
      }
    }
  }

  // Kết thúc SSE response: (tuỳ chọn) enqueue thêm bytes → close → gỡ khỏi jobs map.
  private settle(rt: JobRuntime, extraBytes?: Uint8Array): void {
    rt.settled = true;
    this.clearVisibilityTimer(rt);
    if (extraBytes) this.safeEnqueue(rt, extraBytes);
    if (rt.controller) {
      try {
        rt.controller.close();
      } catch {
        /* controller đã đóng/cancel — ignore */
      }
    }
    this.jobs.delete(rt.job.job_id);
  }

  private async persist(
    rt: JobRuntime,
    extra?: { finish_reason?: string; error_type?: string },
  ): Promise<void> {
    const record: JobRecord = {
      job_id: rt.job.job_id,
      request_id: rt.job.request_id,
      tenant_id: rt.job.tenant_id,
      status: rt.status as JobRecordStatus,
      created_at: rt.createdAt,
      updated_at: Date.now(),
      chunk_count: rt.chunkCount,
      finish_reason: extra?.finish_reason,
      error_type: extra?.error_type,
    };
    try {
      await this.deps.store.saveJob(rt.job.tenant_id, record);
    } catch (err) {
      log('warn', 'failed to persist job record', {
        job_id: rt.job.job_id,
        error: String(err),
      });
    }
  }
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
