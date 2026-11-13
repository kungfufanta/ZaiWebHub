// mini-services/worker — src/ws-client.ts
// Port từ ZaiWebHub apps/worker/src/worker/ws-client.ts (T2-a + Task 3.6-W), ADAPTED cho sandbox:
// - Chạy trong Bun mini-service (bun --hot) — WS outbound dùng WebSocket NGUYÊN BUN (không cần npm `ws`).
// - Worker TỰ connect ra hub — hub KHÔNG bao giờ inbound vào sandbox (sandbox không có inbound).
// - Boot khi service start (index.ts) hoặc POST /api/setup — KHÔNG bao giờ chạy trong request handler
//   dài hạn; routes chỉ đọc status.
// - Mọi JSON control frame đều validate bằng HubToWorkerSchema / WorkerToHubSchema trước khi dùng.
// - Backpressure BẮT BUỘC: bufferedAmount > 1MB → pause tới < 256KB (PLAN T2-b).
// - Reconnect backoff 1s→2s→4s… max 30s + jitter ±15%. Token ngắn hạn fetch lại MỖI lần open.
import {
  HubToWorkerSchema,
  PROTOCOL_VERSION,
  WorkerToHubSchema,
  type HubToWorker,
  type JobPayload,
  type WorkerToHub,
} from './protocol';
import { loadConfig, type WorkerConfig } from './config';
import { readLiveSecret } from './file-config';
import { startJob, type JobHandle, type JobIo } from './executor';
import { errMsg, log, sleep } from './util';

const TOKEN_FETCH_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;
// Connect timeout BẮT BUỘC (4.0-W fix): WS có thể kẹt ở CONNECTING VĨNH VIỄN khi port hub
// chết/lifecycle flap mà KHÔNG bắn open/error/close (Bun edge case) → connectLoop chết chỗ,
// worker không bao giờ retry lại. Timeout này đảm bảo loop luôn sống lại sau mỗi lần hụt.
const WS_CONNECT_TIMEOUT_MS = 10_000;
// Backpressure BẮT BUỘC (PLAN T2-b): > 1MB → tạm dừng đọc adapter stream tới khi < 256KB.
const BUFFERED_HIGH_WATER = 1_048_576; // 1MB
const BUFFERED_LOW_WATER = 262_144; // 256KB
const WS_OPEN = 1; // WebSocket.OPEN (spec constant — giống cả browser lẫn Bun)

/**
 * Wrapper mỏng quanh WebSocket của Bun — giữ cùng shape hành vi như bản `ws` gốc của repo
 * (readyState / bufferedAmount / send text & binary / close) để logic phía dưới port 1:1.
 */
interface WsConn {
  readyState: number;
  bufferedAmount: number;
  send(text: string): void;
  sendBinary(bytes: Uint8Array): void;
  close(): void;
}

interface WsCallbacks {
  onOpen: (ws: WsConn) => void;
  onMessage: (ws: WsConn, data: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

function openWs(url: string, cb: WsCallbacks): WsConn | null {
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    // URL hỏng / scheme sai — báo error để loop backoff xử lý, KHÔNG crash process.
    cb.onError(err instanceof Error ? err : new Error(String(err)));
    return null;
  }
  ws.binaryType = 'arraybuffer';

  const conn: WsConn = {
    get readyState() {
      return ws.readyState;
    },
    get bufferedAmount() {
      return typeof ws.bufferedAmount === 'number' ? ws.bufferedAmount : 0;
    },
    send(text: string) {
      ws.send(text);
    },
    sendBinary(bytes: Uint8Array) {
      // Zero-copy pass — Bun chấp nhận ArrayBufferView, bytes KHÔNG đổi (F4).
      ws.send(bytes);
    },
    close() {
      try {
        ws.close();
      } catch {
        // bỏ qua
      }
    },
  };

  ws.onopen = () => cb.onOpen(conn);
  ws.onmessage = (ev: MessageEvent) => {
    // Hub chỉ gửi JSON text frame trong v1 — binary từ hub bị bỏ qua.
    if (typeof ev.data === 'string') cb.onMessage(conn, ev.data);
  };
  ws.onerror = (ev: Event) => {
    // Bun không luôn expose message trong Event — thử (ev as ErrorEvent).message nếu có.
    const maybe = ev as ErrorEvent;
    cb.onError(new Error(maybe?.message || 'websocket error'));
  };
  ws.onclose = () => cb.onClose();

  return conn;
}

export interface WorkerState {
  config: WorkerConfig;
  ws: WsConn | null;
  connected: boolean;
  registered: boolean;
  bootedAt: number;
  attempt: number;
  inflight: Map<string, JobHandle>;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  stopping: boolean;
  running: boolean;
  phase: 'connecting' | 'registering' | 'online' | 'reconnecting' | 'stopped';
  totalJobs: number;
  lastHeartbeatAt: number | null;
  lastError: string | null;
  startedSource: string;
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
      running: false,
      phase: 'stopped',
      totalJobs: 0,
      lastHeartbeatAt: null,
      lastError: null,
      startedSource: '',
    };
  }
  return g.__zaiwebhubWorkerState;
}

/** GET /api/health đọc status này (không start worker từ route — boot chỉ xảy ra ở service start/setup). */
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

/** Thông tin mở rộng cho /api/status + dashboard UI. KHÔNG bao giờ trả worker_secret qua đây. */
export function getRuntimeInfo(): {
  running: boolean;
  phase: WorkerState['phase'];
  worker_id: string;
  hub_url_ws: string;
  hub_http_base: string;
  hub_token_url: string;
  connected: boolean;
  registered: boolean;
  inflight: number;
  total_jobs: number;
  attempt: number;
  uptime_s: number;
  last_heartbeat: number | null;
  last_error: string | null;
  upstream: string;
  mode: string;
  tenant_id: string;
  concurrency: number;
  models: string[];
} {
  const s = getState();
  const connected = s.connected && !!s.ws && s.ws.readyState === WS_OPEN;
  const phase: WorkerState['phase'] = s.running
    ? connected && s.registered
      ? 'online'
      : s.attempt > 0
        ? 'reconnecting'
        : s.ws
          ? 'registering'
          : 'connecting'
    : 'stopped';
  return {
    running: s.running,
    phase,
    worker_id: s.config.workerId,
    hub_url_ws: s.config.hubUrl,
    hub_http_base: s.config.hubHttpBase,
    hub_token_url: s.config.hubTokenUrl,
    connected,
    registered: s.registered,
    inflight: s.inflight.size,
    total_jobs: s.totalJobs,
    attempt: s.attempt,
    uptime_s: Math.round((Date.now() - s.bootedAt) / 1000),
    last_heartbeat: s.lastHeartbeatAt,
    last_error: s.lastError,
    upstream: s.config.upstream,
    mode: s.config.mode,
    tenant_id: s.config.tenantId,
    concurrency: s.config.concurrency,
    models: s.config.models,
  };
}

function sameRuntimeConfig(a: WorkerConfig, b: WorkerConfig): boolean {
  return (
    a.hubUrl === b.hubUrl &&
    a.hubTokenUrl === b.hubTokenUrl &&
    a.workerId === b.workerId &&
    a.workerSecret === b.workerSecret
  );
}

/**
 * Start runtime WS (singleton). Gọi từ service boot HOẶC POST /api/setup.
 * - Đang chạy + cùng config → no-op (chống double connect).
 * - Đang chạy + khác config → stop sạch rồi start lại với config mới.
 */
export function startRuntime(config: WorkerConfig, source = 'boot'): void {
  const cur = g.__zaiwebhubWorkerState;
  if (g.__zaiwebhubWorkerStarted && cur && cur.running && !cur.stopping) {
    if (sameRuntimeConfig(cur.config, config)) {
      log('info', 'startRuntime ignored — already running with same config (singleton guard)', {
        worker_id: config.workerId,
      });
      return;
    }
    log('info', 'startRuntime — config changed, stopping current runtime first', {
      worker_id: cur.config.workerId,
    });
    stopRuntime();
  }
  g.__zaiwebhubWorkerState = {
    config,
    ws: null,
    connected: false,
    registered: false,
    bootedAt: Date.now(),
    attempt: 0,
    inflight: new Map<string, JobHandle>(),
    heartbeatTimer: null,
    stopping: false,
    running: true,
    phase: 'connecting',
    totalJobs: 0,
    lastHeartbeatAt: null,
    lastError: null,
    startedSource: source,
  };
  g.__zaiwebhubWorkerStarted = true;
  const state = g.__zaiwebhubWorkerState;
  log('info', 'worker runtime starting', {
    worker_id: state.config.workerId,
    hub_url: state.config.hubUrl,
    hub_token_url: state.config.hubTokenUrl || '(derive từ hubHttpBase)',
    worker_secret_set: state.config.workerSecret.length > 0,
    tenant_id: state.config.tenantId,
    mode: state.config.mode,
    upstream: state.config.upstream,
    concurrency: state.config.concurrency,
    source,
    protocol_version: PROTOCOL_VERSION,
  });
  void connectLoop(state);
}

/** Stop runtime (POST /api/disconnect): đóng WS, drop in-flight, KHÔNG kill process. */
export function stopRuntime(): void {
  const s = g.__zaiwebhubWorkerState;
  g.__zaiwebhubWorkerStarted = false;
  if (!s) return;
  s.stopping = true;
  s.running = false;
  s.phase = 'stopped';
  stopHeartbeat(s);
  dropInflight(s, 'runtime stopped (disconnect/re-configure)');
  try {
    s.ws?.close();
  } catch {
    // bỏ qua
  }
  log('info', 'worker runtime stopped', { worker_id: s.config.workerId });
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
    state.phase = 'reconnecting';
    log('warn', `WS not connected — retry in ${delay}ms`, {
      worker_id: state.config.workerId,
      attempt: state.attempt,
      hub_url: state.config.hubUrl,
    });
    await sleep(delay);
    if (state.stopping) break; // stop có thể xảy ra trong lúc sleep — kiểm tra lại trước khi connect
  }
}

async function connectOnce(state: WorkerState): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    let connRef: WsConn | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      resolve();
    };

    // Connect timeout: socket không OPEN trong 10s (kẹt CONNECTING/half-open) → đóng + retry.
    const connectTimer = setTimeout(() => {
      if (settled) return;
      log('warn', `WS connect timeout after ${WS_CONNECT_TIMEOUT_MS}ms — closing socket to retry`, {
        worker_id: state.config.workerId,
        hub_url: state.config.hubUrl,
      });
      try {
        connRef?.close();
      } catch {
        // bỏ qua — close có thể no-op nếu socket chưa mở
      }
      // onClose có thể không bắn với socket kẹt — resolve thủ công để loop retry
      finish();
    }, WS_CONNECT_TIMEOUT_MS);
    connectTimer.unref?.();

    const conn = openWs(state.config.hubUrl, {
      onOpen: (c) => {
        state.ws = c;
        state.connected = true;
        state.attempt = 0; // kết nối thành công → reset backoff
        state.phase = 'registering';
        state.lastError = null;
        log('info', 'WS connected — fetching short-lived worker token', {
          worker_id: state.config.workerId,
          hub_url: state.config.hubUrl,
        });
        fetchToken(state)
          .then((token) => {
            if (state.ws !== c || c.readyState !== WS_OPEN) return; // socket cũ/stale
            sendRegister(state, c, token);
            state.registered = true;
            state.phase = 'online';
            startHeartbeat(state);
            log('info', 'worker.register sent', {
              worker_id: state.config.workerId,
              tenant_id: state.config.tenantId,
              concurrency: state.config.concurrency,
              models: state.config.models,
              protocol_version: PROTOCOL_VERSION,
            });
          })
          .catch((err) => {
            // 401 (sai secret) / 404 / ECONNREFUSED → đóng sạch, vòng lặp ngoài sẽ retry backoff.
            state.lastError = errMsg(err);
            log('error', 'worker token fetch failed — closing socket to retry', {
              worker_id: state.config.workerId,
              error: errMsg(err),
            });
            c.close();
          });
      },
      onMessage: (c, data) => {
        try {
          handleServerFrame(state, c, data);
        } catch (err) {
          log('error', 'unexpected error while handling hub frame — ignored', {
            worker_id: state.config.workerId,
            error: errMsg(err),
          });
        }
      },
      onError: (err) => {
        // Ví dụ: "connect ECONNREFUSED 127.0.0.1:3003" khi hub chưa chạy — KHÔNG crash, close sẽ theo sau.
        state.lastError = errMsg(err);
        log('warn', `WS error: ${errMsg(err)}`, {
          worker_id: state.config.workerId,
          hub_url: state.config.hubUrl,
        });
      },
      onClose: () => {
        stopHeartbeat(state);
        dropInflight(state, 'ws disconnected — worker drops in-flight jobs, never auto-retries');
        state.connected = false;
        state.registered = false;
        if (connRef && state.ws === connRef) state.ws = null;
        log('info', 'WS closed', { worker_id: state.config.workerId });
        finish();
      },
    });

    if (!conn) {
      // Construct failed ngay (URL hỏng…) — onError đã bắn; resolve để vòng backoff retry.
      finish();
      return;
    }
    // Socket đang CONNECTING — set ngay như bản gốc (stale-check trong onOpen dựa vào việc này).
    connRef = conn;
    state.ws = conn;
  });
}
/**
 * Token: WORKER_TOKEN env nếu có; nếu không thì fetch token endpoint.
 * HUB_TOKEN_URL (full URL, có thể kèm ?XTransformPort=...) ưu tiên hơn hubHttpBase;
 * WORKER_SECRET (nếu set) gửi kèm header X-Worker-Secret — hub từ chối 401 nếu sai.
 * TTL ~60s → gọi LẠI ở mỗi lần open/reconnect (không cache).
 * 4.0-W: config boot từ file ('file' | 'ui-setup') → re-read worker_secret LIVE từ
 * worker-config.json trước mỗi lần fetch — owner TẠO/XOAY secret trên web UI (console
 * POST /api/worker-secret cũng sync file này) → áp dụng NGAY lần reconnect kế, không restart.
 * 401 / 404 / connection-refused → throw → retry backoff (KHÔNG log secret).
 */
async function fetchToken(state: WorkerState): Promise<string> {
  const envToken = process.env.WORKER_TOKEN;
  if (envToken && envToken.length > 0) return envToken;
  if (state.startedSource === 'file' || state.startedSource === 'ui-setup') {
    const live = await readLiveSecret();
    if (live && live !== state.config.workerSecret) {
      log('info', 'worker secret rotated on hub UI — picked up fresh value from config file', {
        worker_id: state.config.workerId,
      });
      state.config.workerSecret = live;
    }
  }
  const { hubTokenUrl, hubHttpBase, tenantId, workerSecret } = state.config;
  const base = hubTokenUrl || `${hubHttpBase}/internal/worker-token`;
  const joiner = base.includes('?') ? '&' : '?';
  const url = `${base}${joiner}tenant_id=${encodeURIComponent(tenantId)}`;
  const headers: Record<string, string> = {};
  if (workerSecret) headers['X-Worker-Secret'] = workerSecret;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`worker-token endpoint HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const candidate: unknown =
    body?.token ?? ((body?.data as Record<string, unknown> | undefined)?.token ?? undefined);
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new Error('worker-token response missing token field');
  }
  return candidate;
}

function sendRegister(state: WorkerState, ws: WsConn, token: string): void {
  const frame: WorkerToHub = {
    type: 'worker.register',
    capabilities: {
      worker_id: state.config.workerId,
      tenant_id: state.config.tenantId,
      models: state.config.models,
      concurrency: state.config.concurrency,
      protocol_version: PROTOCOL_VERSION,
      version: state.config.version,
    },
    token,
  };
  sendControl(state, ws, frame);
}

/** Outbound control frame: validate bằng WorkerToHubSchema TRƯỚC khi gửi (never trust even ourselves). */
function sendControl(state: WorkerState, ws: WsConn, frame: WorkerToHub): void {
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

function handleServerFrame(state: WorkerState, ws: WsConn, data: string): void {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
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
      // Protocol v1 không có worker.pong — đáp bằng worker.heartbeat (giữ protocol sạch).
      sendControl(state, ws, {
        type: 'worker.heartbeat',
        ts: Date.now(),
        inflight: state.inflight.size,
      });
      break;
  }
}

function onJobDispatch(state: WorkerState, ws: WsConn, job: JobPayload): void {
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
    isOpen: () => ws.readyState === WS_OPEN,
  };
  const handle = startJob(job, io);
  state.inflight.set(job.job_id, handle);
  state.totalJobs += 1;
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
  ws: WsConn,
  payload: Uint8Array,
): Promise<boolean> {
  const logCtx = { worker_id: state.config.workerId };
  if (ws.readyState !== WS_OPEN) return false;
  if (ws.bufferedAmount > BUFFERED_HIGH_WATER) {
    let waitedMs = 0;
    while (ws.readyState === WS_OPEN && ws.bufferedAmount >= BUFFERED_LOW_WATER) {
      await sleep(50);
      waitedMs += 50;
    }
    if (waitedMs > 0) {
      log('info', `backpressure: paused sending for ${waitedMs}ms (bufferedAmount drained)`, {
        ...logCtx,
        buffered_before: BUFFERED_HIGH_WATER,
      });
    }
    if (ws.readyState !== WS_OPEN) return false;
  }
  try {
    // Zero-copy pass — bytes KHÔNG đổi (F4).
    ws.sendBinary(payload);
    return true;
  } catch (err) {
    log('warn', 'binary frame send failed', { ...logCtx, error: errMsg(err) });
    return false;
  }
}

function startHeartbeat(state: WorkerState): void {
  stopHeartbeat(state);
  state.lastHeartbeatAt = Date.now();
  state.heartbeatTimer = setInterval(() => {
    const ws = state.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    state.lastHeartbeatAt = Date.now();
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
