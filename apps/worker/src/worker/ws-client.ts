// apps/worker — src/worker/ws-client.ts (T2-a)
// WS outbound client (library `ws`): worker TỰ connect ra hub — hub KHÔNG bao giờ inbound vào sandbox.
// Boot 1 lần qua src/instrumentation.ts register() (D1: KHÔNG chạy trong request handler).
// Mọi JSON control frame đều parse bằng HubToWorkerSchema / validate bằng WorkerToHubSchema trước khi dùng —
// không tin phía bên kia (protocol PLAN: "2 bên validate trước khi dùng").
// NOTE: import 'ws' ở đây là TYPE-ONLY + lazy `await import('ws')` khi connect — Next dev còn compile
// module graph của instrumentation cho edge runtime; builtin/lib node-only phải nằm ngoài path tĩnh.
import type WebSocket from 'ws';
import {
  HubToWorkerSchema,
  PROTOCOL_VERSION,
  WorkerToHubSchema,
  type HubToWorker,
  type JobPayload,
  type WorkerToHub,
} from '@zaiwebhub/protocol';
import { loadConfig, type WorkerConfig } from './config';
import { startJob, type JobHandle, type JobIo } from './executor';
import { errMsg, log, sleep } from './util';

const TOKEN_FETCH_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
// Backpressure BẮT BUỘC (PLAN T2-b): > 1MB → tạm dừng đọc adapter stream tới khi < 256KB.
const BUFFERED_HIGH_WATER = 1_048_576; // 1MB
const BUFFERED_LOW_WATER = 262_144; // 256KB
// ws readyState constant (WebSocket.OPEN) — dùng literal để tránh chạm value import 'ws' lúc compile edge.
const WS_OPEN = 1;

// Constructor của ws được load lazy (edge-safe). Instance type lấy từ `import type WebSocket from 'ws'`.
type WsClassType = new (url: string) => WebSocket;
let wsClass: WsClassType | null = null;

async function loadWsClass(): Promise<WsClassType> {
  if (!wsClass) {
    wsClass = (await import('ws')).default as WsClassType;
  }
  return wsClass;
}

export interface WorkerState {
  config: WorkerConfig;
  ws: WebSocket | null;
  connected: boolean;
  registered: boolean;
  bootedAt: number;
  attempt: number;
  inflight: Map<string, JobHandle>;
  heartbeatTimer: NodeJS.Timeout | null;
  stopping: boolean;
}

type WorkerGlobal = typeof globalThis & {
  __zaiwebhubWorkerState?: WorkerState;
  __zaiwebhubWorkerStarted?: boolean;
};
const g = globalThis as WorkerGlobal;

function getState(): WorkerState {
  if (!g.__zaiwebhubWorkerState) {
    g.__zaiwebhubWorkerState = {
      config: loadConfig(),
      ws: null,
      connected: false,
      registered: false,
      bootedAt: Date.now(),
      attempt: 0,
      inflight: new Map<string, JobHandle>(),
      heartbeatTimer: null,
      stopping: false,
    };
  }
  return g.__zaiwebhubWorkerState;
}

/** GET /api/health đọc status này (không start worker từ route — boot chỉ xảy ra ở instrumentation). */
export function getWorkerStatus(): {
  worker_id: string;
  connected: boolean;
  registered: boolean;
  inflight: number;
  mode: string;
  upstream: string;
  hub_url: string;
  tenant_id: string;
  protocol_version: number;
  version: string;
  attempt: number;
  uptime_s: number;
} {
  const s = getState();
  return {
    worker_id: s.config.workerId,
    connected: s.connected && !!s.ws && s.ws.readyState === WS_OPEN,
    registered: s.registered,
    inflight: s.inflight.size,
    mode: s.config.mode,
    upstream: s.config.upstream,
    hub_url: s.config.hubUrl,
    tenant_id: s.config.tenantId,
    protocol_version: PROTOCOL_VERSION,
    version: s.config.version,
    attempt: s.attempt,
    uptime_s: Math.round((Date.now() - s.bootedAt) / 1000),
  };
}

export function startWorker(): void {
  if (g.__zaiwebhubWorkerStarted) {
    log('warn', 'startWorker() called again — already started (global flag guards double boot)', {
      worker_id: getState().config.workerId,
    });
    return;
  }
  g.__zaiwebhubWorkerStarted = true;
  const state = getState();
  log('info', 'worker booting — WS outbound client starting', {
    worker_id: state.config.workerId,
    hub_url: state.config.hubUrl,
    hub_http_base: state.config.hubHttpBase,
    tenant_id: state.config.tenantId,
    mode: state.config.mode,
    upstream: state.config.upstream,
    concurrency: state.config.concurrency,
    protocol_version: PROTOCOL_VERSION,
  });
  void connectLoop(state);
}

function backoffDelayMs(attempt: number): number {
  // exponential 1s→2s→4s… max 30s, jitter ±15%
  const raw = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.min(attempt, 10));
  return Math.max(250, Math.round(raw * (0.85 + Math.random() * 0.3)));
}

async function connectLoop(state: WorkerState): Promise<void> {
  while (!state.stopping) {
    try {
      await connectOnce(state);
    } catch (err) {
      log('error', 'connect loop unexpected error', {
        worker_id: state.config.workerId,
        error: errMsg(err),
      });
    }
    if (state.stopping) break;
    const delay = backoffDelayMs(state.attempt);
    state.attempt += 1;
    log('warn', `WS not connected — retry in ${delay}ms`, {
      worker_id: state.config.workerId,
      attempt: state.attempt,
      hub_url: state.config.hubUrl,
    });
    await sleep(delay);
  }
}

async function connectOnce(state: WorkerState): Promise<void> {
  // Load class `ws` lazy (edge-safe) trước khi mở Promise của socket.
  let WS: WsClassType;
  try {
    WS = await loadWsClass();
  } catch (err) {
    log('error', 'ws lib load failed', {
      worker_id: state.config.workerId,
      error: errMsg(err),
    });
    return;
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    let ws: WebSocket;
    try {
      ws = new WS(state.config.hubUrl);
    } catch (err) {
      log('error', 'WebSocket construct failed (bad HUB_URL?)', {
        worker_id: state.config.workerId,
        hub_url: state.config.hubUrl,
        error: errMsg(err),
      });
      finish();
      return;
    }
    state.ws = ws;

    ws.on('open', () => {
      state.connected = true;
      state.attempt = 0; // kết nối thành công → reset backoff
      log('info', 'WS connected — fetching short-lived worker token', {
        worker_id: state.config.workerId,
        hub_url: state.config.hubUrl,
      });
      fetchToken(state)
        .then((token) => {
          if (state.ws !== ws || ws.readyState !== WebSocket.OPEN) return; // socket cũ/stale
          sendRegister(state, ws, token);
          state.registered = true;
          startHeartbeat(state);
          log('info', 'worker.register sent', {
            worker_id: state.config.workerId,
            tenant_id: state.config.tenantId,
            concurrency: state.config.concurrency,
            models: ['glm-5.3'],
            protocol_version: PROTOCOL_VERSION,
          });
        })
        .catch((err) => {
          // 404 / ECONNREFUSED (hub chưa lên) → đóng sạch, vòng lặp ngoài sẽ retry backoff.
          log('error', 'worker token fetch failed — closing socket to retry', {
            worker_id: state.config.workerId,
            error: errMsg(err),
          });
          try {
            ws.close();
          } catch {
            // bỏ qua
          }
        });
    });

    ws.on('message', (data, isBinary) => {
      try {
        handleServerFrame(state, ws, data, isBinary);
      } catch (err) {
        log('error', 'unexpected error while handling hub frame — ignored', {
          worker_id: state.config.workerId,
          error: errMsg(err),
        });
      }
    });

    ws.on('error', (err) => {
      // Ví dụ: "connect ECONNREFUSED 127.0.0.1:3003" khi hub chưa chạy — KHÔNG crash, 'close' sẽ theo sau.
      log('warn', `WS error: ${errMsg(err)}`, {
        worker_id: state.config.workerId,
        hub_url: state.config.hubUrl,
      });
    });

    ws.on('close', () => {
      stopHeartbeat(state);
      dropInflight(state, 'ws disconnected — worker drops in-flight jobs, never auto-retries');
      state.connected = false;
      state.registered = false;
      if (state.ws === ws) state.ws = null;
      log('info', 'WS closed', { worker_id: state.config.workerId });
      finish();
    });
  });
}

/**
 * Token: WORKER_TOKEN env nếu có; nếu không thì fetch `${HUB_HTTP_BASE}/internal/worker-token?tenant_id=...`.
 * TTL ~60s → gọi LẠI ở mỗi lần open/reconnect (không cache).
 * 404 / connection-refused (hub do agent 3-b làm song song, có thể chưa lên) → throw → retry backoff.
 * KHÔNG log giá trị token.
 */
async function fetchToken(state: WorkerState): Promise<string> {
  const envToken = process.env.WORKER_TOKEN;
  if (envToken && envToken.length > 0) return envToken;
  const url = `${state.config.hubHttpBase}/internal/worker-token?tenant_id=${encodeURIComponent(state.config.tenantId)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`worker-token endpoint HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const candidate: unknown =
    body?.token ?? ((body?.data as Record<string, unknown> | undefined)?.token ?? undefined);
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('worker-token response missing token field');
  }
  return candidate;
}

function sendRegister(state: WorkerState, ws: WebSocket, token: string): void {
  const frame: WorkerToHub = {
    type: 'worker.register',
    capabilities: {
      worker_id: state.config.workerId,
      tenant_id: state.config.tenantId,
      models: ['glm-5.3'],
      concurrency: state.config.concurrency,
      protocol_version: PROTOCOL_VERSION,
      version: state.config.version,
    },
    token,
  };
  sendControl(state, ws, frame);
}

/** Outbound control frame: validate bằng WorkerToHubSchema TRƯỚC khi gửi (never trust even ourselves). */
function sendControl(state: WorkerState, ws: WebSocket, frame: WorkerToHub): void {
  const jobId = 'job_id' in frame ? frame.job_id : undefined;
  const logCtx: Record<string, unknown> = {
    worker_id: state.config.workerId,
    frame_type: frame.type,
    ...(jobId ? { job_id: jobId } : {}),
  };
  const parsed = WorkerToHubSchema.safeParse(frame);
  if (!parsed.success) {
    log('error', 'outbound control frame failed WorkerToHubSchema — dropped (internal bug)', {
      ...logCtx,
      issues: parsed.error.issues.length,
    });
    return;
  }
  if (ws.readyState !== WS_OPEN) {
    log('warn', 'control frame dropped — socket not open', logCtx);
    return;
  }
  try {
    ws.send(JSON.stringify(parsed.data));
  } catch (err) {
    log('warn', 'control frame send failed', { ...logCtx, error: errMsg(err) });
  }
}

function handleServerFrame(
  state: WorkerState,
  ws: WebSocket,
  data: unknown,
  isBinary: boolean,
): void {
  if (isBinary) {
    // job.chunk binary chỉ đi chiều worker→hub — hub không gửi binary cho worker trong v1.
    log('warn', 'unexpected binary frame from hub — ignored', {
      worker_id: state.config.workerId,
    });
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(String(data));
  } catch {
    log('warn', 'non-JSON text frame from hub — ignored', { worker_id: state.config.workerId });
    return;
  }
  const parsed = HubToWorkerSchema.safeParse(raw);
  if (!parsed.success) {
    log('warn', 'hub frame failed HubToWorkerSchema — ignored', {
      worker_id: state.config.workerId,
      issues: parsed.error.issues.slice(0, 3).map((i) => i.path.join('.') || '(root)').join(','),
    });
    return;
  }
  const frame: HubToWorker = parsed.data;
  switch (frame.type) {
    case 'job.dispatch':
      onJobDispatch(state, ws, frame.job);
      break;
    case 'job.cancel':
      onJobCancel(state, frame.job_id, frame.reason);
      break;
    case 'worker.ping':
      // Protocol v1 không có worker.pong — đáp bằng worker.heartbeat (thuộc WorkerToHub, giữ protocol sạch).
      sendControl(state, ws, {
        type: 'worker.heartbeat',
        ts: Date.now(),
        inflight: state.inflight.size,
      });
      break;
  }
}

function onJobDispatch(state: WorkerState, ws: WebSocket, job: JobPayload): void {
  const logCtx = {
    worker_id: state.config.workerId,
    job_id: job.job_id,
    request_id: job.request_id,
  };
  if (state.inflight.has(job.job_id)) {
    log('warn', 'duplicate job.dispatch — already inflight, ignored', logCtx);
    return;
  }
  if (state.inflight.size >= state.config.concurrency) {
    log('warn', 'dispatch above declared concurrency — accepting anyway (at-most-once)', {
      ...logCtx,
      inflight: state.inflight.size,
      declared_concurrency: state.config.concurrency,
    });
  }
  // job.ack gửi NGAY trước khi chạy bất cứ gì (PLAN T2-b).
  sendControl(state, ws, { type: 'job.ack', job_id: job.job_id });

  const io: JobIo = {
    sendControl: (frame) => sendControl(state, ws, frame),
    sendBinary: (payload) => sendBinaryWithBackpressure(state, ws, payload),
    isOpen: () => ws.readyState === WebSocket.OPEN,
  };
  const handle = startJob(job, io);
  state.inflight.set(job.job_id, handle);
  void handle.done.then(() => {
    state.inflight.delete(job.job_id);
  });
  log('info', 'job started', {
    ...logCtx,
    model: job.model,
    thinking: job.thinking.type,
    message_count: job.messages.length,
    inflight: state.inflight.size,
  });
}

function onJobCancel(state: WorkerState, jobId: string, reason?: string): void {
  const logCtx = { worker_id: state.config.workerId, job_id: jobId, reason: reason ?? undefined };
  const handle = state.inflight.get(jobId);
  if (!handle) {
    log('info', 'job.cancel for unknown/already-finished job — ignored', logCtx);
    return;
  }
  log('info', 'job.cancel received — aborting adapter stream', logCtx);
  try {
    handle.controller.abort();
  } catch (err) {
    log('warn', 'job.cancel abort threw — ignored', { ...logCtx, error: errMsg(err) });
  }
}

/** WS đứt → drop sạch in-flight jobs (hub owns at-most-once); KHÔNG tự retry job. */
function dropInflight(state: WorkerState, reason: string): void {
  if (state.inflight.size === 0) return;
  log('warn', `dropping in-flight jobs: ${reason}`, {
    worker_id: state.config.workerId,
    count: state.inflight.size,
    job_ids: [...state.inflight.keys()],
  });
  for (const [, handle] of state.inflight) {
    try {
      handle.controller.abort();
    } catch {
      // bỏ qua
    }
  }
  state.inflight.clear();
}

/**
 * BINARY frame + backpressure BẮT BUỘC: trước khi gửi mỗi chunk, nếu bufferedAmount > 1MB
 * → chờ ~50ms/lượt tới khi bufferedAmount < 256KB rồi mới gửi (PLAN T2-b).
 */
async function sendBinaryWithBackpressure(
  state: WorkerState,
  ws: WebSocket,
  payload: Uint8Array,
): Promise<boolean> {
  const logCtx = { worker_id: state.config.workerId };
  if (ws.readyState !== WebSocket.OPEN) return false;
  if (ws.bufferedAmount > BUFFERED_HIGH_WATER) {
    let waitedMs = 0;
    while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount >= BUFFERED_LOW_WATER) {
      await sleep(50);
      waitedMs += 50;
    }
    if (waitedMs > 0) {
      log('info', `backpressure: paused sending for ${waitedMs}ms (bufferedAmount drained)`, {
        ...logCtx,
        buffered_before: BUFFERED_HIGH_WATER,
      });
    }
    if (ws.readyState !== WebSocket.OPEN) return false;
  }
  try {
    // Zero-copy view sang Buffer (bytes KHÔNG đổi — F4).
    ws.send(Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength));
    return true;
  } catch (err) {
    log('warn', 'binary frame send failed', { ...logCtx, error: errMsg(err) });
    return false;
  }
}

function startHeartbeat(state: WorkerState): void {
  stopHeartbeat(state);
  state.heartbeatTimer = setInterval(() => {
    const ws = state.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    sendControl(state, ws, {
      type: 'worker.heartbeat',
      ts: Date.now(),
      inflight: state.inflight.size,
    });
  }, state.config.heartbeatIntervalMs);
  state.heartbeatTimer.unref?.();
}

function stopHeartbeat(state: WorkerState): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}
