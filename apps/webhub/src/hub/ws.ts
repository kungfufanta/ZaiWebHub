// apps/webhub — hub/ws.ts (T3-a)
// WS hub server: upgrade CHỈ tại path /worker (socket khác → destroy ngay).
// Frame đầu tiên từ connection PHẢI là worker.register hợp lệ (zod WorkerToHubSchema)
// với token hub-mint TTL ~60s (T3-f) + tenant khớp + protocol_version khớp —
// sai bất cứ điều nào → close 4401.
// Registry sweep 10s: last_heartbeat > 45s → coi worker chết (terminate + gỡ registry).
// inflight: sync từ worker.heartbeat (authoritative) + cập nhật theo lifecycle job (dispatcher).
import { WebSocketServer, type WebSocket } from 'ws';
import type { Duplex } from 'node:stream';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import {
  WorkerToHubSchema,
  HubToWorkerSchema,
  PROTOCOL_VERSION,
  decodeChunkFrame,
  type WorkerCapabilities,
  type HubToWorker,
} from '@zaiwebhub/protocol';
import { verifyWorkerToken } from '../auth.js';
import { log } from '../logger.js';

export const HEARTBEAT_TIMEOUT_MS = 45_000;
const SWEEP_INTERVAL_MS = 10_000;

export interface WorkerEntry {
  ws: WebSocket;
  worker_id: string;
  tenant_id: string;
  capabilities: WorkerCapabilities;
  inflight: number;
  last_heartbeat: number;
}

export interface HubHooks {
  onWorkerRegistered(entry: WorkerEntry): void;
  // Worker chết (socket close/error/heartbeat timeout) — dispatcher lo các job in-flight.
  onWorkerRemoved(entry: WorkerEntry): void;
  onHeartbeat(entry: WorkerEntry, inflight: number): void;
  onAck(workerId: string, jobId: string): void;
  onChunk(workerId: string, jobId: string, seq: number, payload: Uint8Array): void;
  onDone(
    workerId: string,
    jobId: string,
    finishReason: string,
    usage?: { prompt_tokens: number; completion_tokens: number },
    upstreamDoneRelayed?: boolean,
  ): void;
  onError(workerId: string, jobId: string, error: { message: string; type: string }): void;
}

function toBuffer(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data.map((b) => Buffer.from(b as Uint8Array)));
  return Buffer.from(data as Uint8Array);
}

export class WorkerHub {
  readonly registry = new Map<string, WorkerEntry>(); // key: worker_id
  private bySocket = new Map<WebSocket, WorkerEntry>();
  private wss = new WebSocketServer({ noServer: true });
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private hooks: HubHooks) {}

  // Gắn vào HTTP server: chặn 'upgrade', CHỈ chấp nhận path /worker.
  attach(server: HttpServer): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      let pathname = '';
      try {
        pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname !== '/worker') {
        socket.destroy(); // mọi path upgrade khác → destroy (T3-a)
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.handleConnection(ws));
    });
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref();
    log('info', 'ws hub attached', { path: '/worker' });
  }

  isOpen(entry: WorkerEntry): boolean {
    return entry.ws.readyState === 1 /* WebSocket.OPEN */;
  }

  // Gửi JSON control frame cho worker — validate HubToWorkerSchema trước khi send (2 đầu validate).
  sendToWorker(workerId: string, frame: HubToWorker): boolean {
    const entry = this.registry.get(workerId);
    if (!entry || !this.isOpen(entry)) return false;
    const parsed = HubToWorkerSchema.safeParse(frame);
    if (!parsed.success) {
      log('error', 'refused to send invalid hub frame', { worker_id: workerId });
      return false;
    }
    try {
      entry.ws.send(JSON.stringify(parsed.data));
      return true;
    } catch (err) {
      log('warn', 'ws send failed', { worker_id: workerId, error: String(err) });
      return false;
    }
  }

  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const entry of this.registry.values()) {
      try {
        entry.ws.close(1001, 'hub shutting down');
      } catch {
        /* ignore */
      }
    }
    this.registry.clear();
    this.bySocket.clear();
  }

  // ---------- internals ----------

  private handleConnection(ws: WebSocket): void {
    let entry: WorkerEntry | null = null;

    ws.on('message', (data: unknown, isBinary: boolean) => {
      if (!entry) {
        entry = this.handleFirstMessage(ws, data);
        return;
      }
      try {
        if (isBinary) {
          this.handleBinary(entry, data);
          return;
        }
        this.handleControl(entry, toBuffer(data).toString('utf8'));
      } catch (err) {
        log('warn', 'ws message handling error', {
          worker_id: entry.worker_id,
          error: String(err),
        });
      }
    });

    ws.on('close', () => {
      const e = this.bySocket.get(ws);
      this.bySocket.delete(ws);
      if (e) this.dropWorker(e, 'socket closed');
    });

    ws.on('error', (err: Error) => {
      log('warn', 'worker ws error', { error: err.message });
    });
  }

  // Frame ĐẦU TIÊN phải là worker.register hợp lệ; trả entry nếu OK, else null (socket đã close).
  private handleFirstMessage(ws: WebSocket, data: unknown): WorkerEntry | null {
    let parsedFrame: unknown;
    try {
      parsedFrame = JSON.parse(toBuffer(data).toString('utf8'));
    } catch {
      ws.close(4401, 'first frame must be JSON worker.register');
      log('warn', 'register rejected: non-JSON first frame', {});
      return null;
    }
    const parsed = WorkerToHubSchema.safeParse(parsedFrame);
    if (!parsed.success || parsed.data.type !== 'worker.register') {
      ws.close(4401, 'first frame must be worker.register');
      log('warn', 'register rejected: invalid first frame type', {});
      return null;
    }
    const { capabilities, token } = parsed.data;
    const tokenResult = verifyWorkerToken(token);
    if (!tokenResult.ok) {
      ws.close(4401, `invalid worker token: ${tokenResult.reason}`);
      log('warn', 'register rejected: bad token', {
        worker_id: capabilities.worker_id,
        reason: tokenResult.reason,
      });
      return null;
    }
    if (tokenResult.payload.tenant_id !== capabilities.tenant_id) {
      ws.close(4401, 'token tenant does not match capabilities');
      log('warn', 'register rejected: tenant mismatch', {
        worker_id: capabilities.worker_id,
      });
      return null;
    }
    if (capabilities.protocol_version !== PROTOCOL_VERSION) {
      ws.close(4401, `protocol_version mismatch: expected ${PROTOCOL_VERSION}`);
      log('warn', 'register rejected: protocol version mismatch', {
        worker_id: capabilities.worker_id,
        got: capabilities.protocol_version,
        expected: PROTOCOL_VERSION,
      });
      return null;
    }
    // worker_id trùng → đóng connection cũ, giữ connection mới nhất
    const existing = this.registry.get(capabilities.worker_id);
    if (existing) {
      log('warn', 'duplicate worker_id register — replacing old connection', {
        worker_id: capabilities.worker_id,
      });
      this.dropWorker(existing, 'replaced by newer connection');
      try {
        existing.ws.close(4409, 'duplicate worker_id');
      } catch {
        /* ignore */
      }
    }
    const entry: WorkerEntry = {
      ws,
      worker_id: capabilities.worker_id,
      tenant_id: capabilities.tenant_id,
      capabilities,
      inflight: 0,
      last_heartbeat: Date.now(),
    };
    this.registry.set(entry.worker_id, entry);
    this.bySocket.set(ws, entry);
    log('info', 'worker registered', {
      worker_id: entry.worker_id,
      tenant_id: entry.tenant_id,
      concurrency: capabilities.concurrency,
      models_count: capabilities.models.length,
      protocol_version: capabilities.protocol_version,
    });
    this.hooks.onWorkerRegistered(entry);
    return entry;
  }

  private handleControl(entry: WorkerEntry, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      log('warn', 'invalid JSON control frame', { worker_id: entry.worker_id });
      return;
    }
    const parsed = WorkerToHubSchema.safeParse(json);
    if (!parsed.success) {
      log('warn', 'invalid control frame schema', { worker_id: entry.worker_id });
      return;
    }
    const frame = parsed.data;
    switch (frame.type) {
      case 'worker.register': {
        // register lần nữa trên connection đã đăng ký → bỏ qua (đã xử lý ở first message)
        log('warn', 'duplicate register on open connection — ignored', {
          worker_id: entry.worker_id,
        });
        return;
      }
      case 'worker.heartbeat': {
        entry.last_heartbeat = Date.now();
        entry.inflight = frame.inflight; // authoritative từ worker
        this.hooks.onHeartbeat(entry, frame.inflight);
        return;
      }
      case 'job.ack': {
        entry.last_heartbeat = Date.now();
        this.hooks.onAck(entry.worker_id, frame.job_id);
        return;
      }
      case 'job.done': {
        entry.last_heartbeat = Date.now();
        this.hooks.onDone(
          entry.worker_id,
          frame.job_id,
          frame.finish_reason,
          frame.usage,
          frame.upstream_done_relayed,
        );
        return;
      }
      case 'job.error': {
        entry.last_heartbeat = Date.now();
        this.hooks.onError(entry.worker_id, frame.job_id, frame.error);
        return;
      }
    }
  }

  private handleBinary(entry: WorkerEntry, data: unknown): void {
    try {
      const { jobId, seq, payload } = decodeChunkFrame(toBuffer(data));
      this.hooks.onChunk(entry.worker_id, jobId, seq, payload);
    } catch (err) {
      log('warn', 'invalid binary chunk frame', { worker_id: entry.worker_id, error: String(err) });
    }
  }

  private dropWorker(entry: WorkerEntry, reason: string): void {
    if (this.registry.get(entry.worker_id) !== entry) return; // đã bị thay bằng connection mới
    this.registry.delete(entry.worker_id);
    log('warn', 'worker removed from registry', {
      worker_id: entry.worker_id,
      tenant_id: entry.tenant_id,
      reason,
      inflight: entry.inflight,
    });
    this.hooks.onWorkerRemoved(entry);
  }

  private sweep(): void {
    const now = Date.now();
    for (const entry of [...this.registry.values()]) {
      if (now - entry.last_heartbeat > HEARTBEAT_TIMEOUT_MS) {
        log('warn', 'heartbeat timeout — terminating worker socket', {
          worker_id: entry.worker_id,
          idle_ms: now - entry.last_heartbeat,
        });
        try {
          entry.ws.terminate(); // 'close' event → dropWorker → hooks.onWorkerRemoved
        } catch {
          this.dropWorker(entry, 'terminate failed');
        }
      }
    }
  }
}
