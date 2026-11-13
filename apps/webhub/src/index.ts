// apps/webhub — Node + Hono per decision D1 (KHONG Bun runtime, KHONG Next.js).
// WS /worker endpoint se them o T3-a. Dispatcher/StateStore/SSE public: T3-b..T3-f.
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true, service: 'webhub', ts: Date.now() }));

const port = Number(process.env.PORT ?? 3003);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[webhub] listening on :${info.port}`);
});
