// apps/webhub — Node + Hono service thuần (D1: KHÔNG Bun runtime, KHÔNG Next.js).
// T3-a: WS hub + registry + heartbeat sweep | T3-b: dispatcher | T3-c: SSE public API
// T3-d: MemoryStateStore | T3-e/T3-f: auth + security baseline.
// Port 3003 (dev sandbox). Bun CHỈ làm package manager.
import { serve, type ServerType } from '@hono/node-server';
import type { Server as HttpServer } from 'node:http';
import { Hono } from 'hono';
import { WorkerHub, type WorkerEntry } from './hub/ws.js';
import { Dispatcher } from './dispatch.js';
import { MemoryStateStore } from './state.js';
import {
  bearerFromHeader,
  getTenantKeys,
  isValidApiKey,
  logSecurityBaselineWarnings,
  mintWorkerToken,
  DEFAULT_WORKER_TOKEN_TTL_SECONDS,
} from './auth.js';
import { createChatRouter } from './api/chat.js';
import { log } from './logger.js';

const PORT = Number(process.env.PORT ?? 3003);
const MAX_TOKEN_TTL_SECONDS = 300;

const app = new Hono();
const store = new MemoryStateStore();

// Hub hooks cần dispatcher, dispatcher cần hub → dispatcher khai báo bằng closure (deferred)
let dispatcher: Dispatcher;
const hub = new WorkerHub({
  onWorkerRegistered: (entry: WorkerEntry) => dispatcher.onWorkerRegistered(entry),
  onWorkerRemoved: (entry: WorkerEntry) => dispatcher.onWorkerRemoved(entry),
  onHeartbeat: (entry: WorkerEntry, inflight: number) => dispatcher.onHeartbeat(entry, inflight),
  onAck: (workerId: string, jobId: string) => dispatcher.onAck(workerId, jobId),
  onChunk: (workerId: string, jobId: string, seq: number, payload: Uint8Array) =>
    dispatcher.onChunk(workerId, jobId, seq, payload),
  onDone: (workerId: string, jobId: string, finishReason: string, usage, upstreamDoneRelayed) =>
    dispatcher.onDone(workerId, jobId, finishReason, usage, upstreamDoneRelayed),
  onError: (workerId: string, jobId: string, error) =>
    dispatcher.onError(workerId, jobId, error),
});
dispatcher = new Dispatcher({ hub, store });

app.get('/healthz', (c) => c.json({ ok: true, service: 'webhub', ts: Date.now() }));

// T3-f: mint worker token (dev-only route, UNAUTHENTICATED — production hardening TODO)
app.get('/internal/worker-token', (c) => {
  const tenantId = c.req.query('tenant_id') ?? 'default';
  const ttlRaw = Number(c.req.query('ttl') ?? DEFAULT_WORKER_TOKEN_TTL_SECONDS);
  const ttl = Math.min(Math.max(Number.isFinite(ttlRaw) ? ttlRaw : DEFAULT_WORKER_TOKEN_TTL_SECONDS, 5), MAX_TOKEN_TTL_SECONDS);
  const { token, exp } = mintWorkerToken(tenantId, ttl);
  // T3-f: KHÔNG log token nguyên văn — chỉ shape (length + prefix 8 ký tự)
  log('info', 'worker token minted', {
    tenant_id: tenantId,
    ttl_seconds: ttl,
    token_len: token.length,
    token_prefix: token.slice(0, 8),
  });
  return c.json({ token, tenant_id: tenantId, ttl_seconds: ttl, expires_at: exp });
});

// T3-e: Bearer key cho /v1/* — sai key → 401 JSON
app.use('/v1/*', async (c, next) => {
  const key = bearerFromHeader(c.req.header('Authorization'));
  if (!key || !isValidApiKey(key)) {
    log('warn', 'rejected request: invalid api key', { path: c.req.path });
    return c.json({ error: { message: 'invalid api key' } }, 401);
  }
  await next();
});

app.route('/', createChatRouter({ dispatcher, store }));

// Route khác → 404 (mặc định Hono) — log để trace
app.notFound((c) => c.json({ error: { message: 'not found' } }, 404));

logSecurityBaselineWarnings();
log('info', 'webhub booting', {
  port: PORT,
  tenant_key_count: getTenantKeys().length,
  webhub_secret_set: Boolean(process.env.WEBHUB_SECRET),
});

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  log('info', 'webhub listening', { port: info.port, family: info.family });
});

// T3-a: wire WS upgrade (/worker) vào HTTP server
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
