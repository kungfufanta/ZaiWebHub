// mini-services/hub — index.ts (sandbox edition)
// ZaiWebHub hub (control plane) chạy như 1 MINI-SERVICE Bun độc lập (port 3003).
// Port từ apps/webhub/src/index.ts của monorepo gốc — GIỮ NGUYÊN behavior:
// registry + dispatcher + relay SSE byte-blind + auth Bearer + mint worker token.
//
// Vì sao thiết kế này chạy đúng trên sandbox prod (không trắng trang):
//  1. Sandbox chỉ expose port 3000 qua Caddy gateway (default route) — port khác PHẢI đi qua
//     `?XTransformPort=3003`. Console UI nằm ở main app (:3000), hub là tiến trình DÀI HẠN
//     ở mini-service này — tách khỏi UI, không đụng port 3000.
//  2. WS upgrade /worker đi qua cùng HTTP server (node:http compat của Bun) — worker sandbox
//     outbound connect tới `wss://<hub-host>/?XTransformPort=3003` path /worker.
//  3. next.config.ts của main app có rewrite `/v1/chat/completions` → 127.0.0.1:3003 cho
//     ngữ cảnh truy cập TRỰC TIẾP (không qua gateway); qua gateway thì XTransformPort tự forward.
//
// Env (tất cả OPTIONAL — có default dev):
//   PORT=3003                      — port listen
//   TENANT_KEYS=zhb_dev_default_key — Bearer keys cho /v1/* (phân tách phẩy)
//   WEBHUB_SECRET=<hex>            — HMAC signing secret cho worker token
//   WORKER_SECRET=<hex>            — gate /internal/worker-token (header X-Worker-Secret)
//                                    KHÔNG set → dev mode KHÔNG gate — CẤM expose công khai.
import { serve, type ServerType } from '@hono/node-server';
import type { Server as HttpServer } from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerHub, type WorkerEntry } from './src/hub/ws';
import { Dispatcher } from './src/dispatch';
import { MemoryStateStore } from './src/state';
import {
  bearerFromHeader,
  getTenantKeys,
  isWorkerSecretRequired,
  isValidApiKey,
  logSecurityBaselineWarnings,
  matchesWorkerSecret,
  mintWorkerToken,
  DEFAULT_WORKER_TOKEN_TTL_SECONDS,
} from './src/auth';
import { createChatRouter } from './src/api/chat';
import { log } from './src/logger';
import { HubStats } from './src/internal/stats';
import { createInternalWorkersRouter } from './src/internal/workers';

const PORT = Number(process.env.PORT ?? 3003);
const MAX_TOKEN_TTL_SECONDS = 300;

const app = new Hono();
const store = new MemoryStateStore();

// Hub hooks cần dispatcher, dispatcher cần hub → dispatcher khai báo bằng closure (deferred)
let dispatcher: Dispatcher;
// 3.6-H: bộ đếm quan sát cho GET /internal/workers — feed từ 3 hook có sẵn, KHÔNG đổi hành vi.
const stats = new HubStats();
const hub = new WorkerHub({
  onWorkerRegistered: (entry: WorkerEntry) => {
    stats.noteWorkerRegistered(entry);
    dispatcher.onWorkerRegistered(entry);
  },
  onWorkerRemoved: (entry: WorkerEntry) => {
    stats.noteWorkerRemoved(entry);
    dispatcher.onWorkerRemoved(entry);
  },
  onHeartbeat: (entry: WorkerEntry, inflight: number) => dispatcher.onHeartbeat(entry, inflight),
  onAck: (workerId: string, jobId: string) => {
    stats.noteJobAck(workerId, jobId);
    dispatcher.onAck(workerId, jobId);
  },
  onChunk: (workerId: string, jobId: string, seq: number, payload: Uint8Array) =>
    dispatcher.onChunk(workerId, jobId, seq, payload),
  onDone: (workerId: string, jobId: string, finishReason: string, usage, upstreamDoneRelayed) =>
    dispatcher.onDone(workerId, jobId, finishReason, usage, upstreamDoneRelayed),
  onError: (workerId: string, jobId: string, error) =>
    dispatcher.onError(workerId, jobId, error),
});
dispatcher = new Dispatcher({ hub, store });

app.get('/healthz', (c) => c.json({ ok: true, service: 'webhub', ts: Date.now() }));

// CORS cho console/browser ở sandbox khác (auth vẫn là Bearer key — CORS chỉ là
// điều kiện cần để browser gọi chéo origin, KHÔNG phải cơ chế auth).
app.use(
  '/v1/*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Worker-Secret'],
  }),
);

// Mint worker token. WORKER_SECRET set → bắt buộc header X-Worker-Secret khớp
// (timing-safe compare); sai → 401. KHÔNG set → dev loopback-only, KHÔNG expose công khai.
app.get('/internal/worker-token', (c) => {
  const provided = c.req.header('X-Worker-Secret');
  if (isWorkerSecretRequired() && !matchesWorkerSecret(provided)) {
    log('warn', 'worker-token refused: missing/wrong X-Worker-Secret', {
      forwarded_for: c.req.header('X-Forwarded-For') ?? 'unknown',
      path: c.req.path,
    });
    return c.json({ error: { message: 'worker secret required (header X-Worker-Secret)' } }, 401);
  }
  const tenantId = c.req.query('tenant_id') ?? 'default';
  const ttlRaw = Number(c.req.query('ttl') ?? DEFAULT_WORKER_TOKEN_TTL_SECONDS);
  const ttl = Math.min(Math.max(Number.isFinite(ttlRaw) ? ttlRaw : DEFAULT_WORKER_TOKEN_TTL_SECONDS, 5), MAX_TOKEN_TTL_SECONDS);
  const { token, exp } = mintWorkerToken(tenantId, ttl);
  // KHÔNG log token nguyên văn — chỉ shape (length + prefix 8 ký tự)
  log('info', 'worker token minted', {
    tenant_id: tenantId,
    ttl_seconds: ttl,
    token_len: token.length,
    token_prefix: token.slice(0, 8),
  });
  return c.json({ token, tenant_id: tenantId, ttl_seconds: ttl, expires_at: exp });
});

// Bearer key cho /v1/* — sai key → 401 JSON
app.use('/v1/*', async (c, next) => {
  const key = bearerFromHeader(c.req.header('Authorization'));
  if (!key || !isValidApiKey(key)) {
    log('warn', 'rejected request: invalid api key', { path: c.req.path });
    return c.json({ error: { message: 'invalid api key' } }, 401);
  }
  await next();
});

app.route('/', createChatRouter({ dispatcher, store }));

// Endpoint read-only cho Hub UI — auth X-Worker-Secret, không đụng route hiện có.
app.route('/', createInternalWorkersRouter({ hub, stats }));

// Route khác → 404 (mặc định Hono) — log để trace
app.notFound((c) => c.json({ error: { message: 'not found' } }, 404));

logSecurityBaselineWarnings();
log('info', 'webhub booting', {
  port: PORT,
  tenant_key_count: getTenantKeys().length,
  webhub_secret_set: Boolean(process.env.WEBHUB_SECRET),
  worker_secret_required: isWorkerSecretRequired(),
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  log('info', 'webhub listening', { port: info.port, family: info.family });
});

// Wire WS upgrade (/worker) vào HTTP server
hub.attach(server as HttpServer);

// graceful shutdown (dev convenience)
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log('info', 'shutting down', { signal: sig });
    hub.close();
    server.close();
    process.exit(0);
  });
}

export type { ServerType };
