// mini-services/worker — index.ts (sandbox edition, Task: "setup lại web worker cho sandbox")
// ZaiWebHub worker runtime chạy như 1 MINI-SERVICE Bun độc lập (port 3005) — KHÔNG phải Next.js app.
//
// Vì sao thiết kế này chạy đúng trên sandbox prod (không trắng trang):
//  1. Sandbox chỉ expose port 3000 qua Caddy gateway (default route) — port khác PHẢI đi qua
//     `?XTransformPort=`. UI worker vì vậy nằm ở main app (:3000, route `/`), còn runtime WS
//     outbound là tiến trình DÀI HẠN trong mini-service này — tách khỏi UI, không đụng port 3000.
//  2. Không có build step / Next dev server cho worker → không thể trắng trang do static assets,
//     không xung đột port 3000, không phụ thuộc `next dev`.
//  3. UI (:3000) gọi API của service này bằng RELATIVE fetch + ?XTransformPort=3005 (gateway rule).
//
// API (tất cả JSON):
//   GET  /               → service info
//   GET  /api/health     → shape /api/health gốc của repo (ops script dựa vào nó)
//   GET  /api/status     → full runtime info + logs tail (cho dashboard)
//   POST /api/setup      → { hub_url, worker_id, worker_secret } → ghi config file + start runtime
//   POST /api/disconnect → stop runtime + xoá config file
//
// Boot: resolveBootConfig() — ENV (HUB_URL+WORKER_ID+WORKER_SECRET) ưu tiên, sau đó
// worker-config.json (ghi bởi setup UI). Không có config → idle, chờ setup qua dashboard.
import { buildStatusPayload } from './src/status';
import { getWorkerStatus, startRuntime, stopRuntime } from './src/ws-client';
import {
  deleteFileConfig,
  fileConfigToWorkerConfig,
  isValidWorkerId,
  parseHubUrl,
  writeFileConfig,
  getHostname,
} from './src/file-config';
import { errMsg, log } from './src/util';
import { PROTOCOL_VERSION } from './src/protocol';

const PORT = (() => {
  const p = Number.parseInt(process.env.WORKER_PORT ?? '3005', 10);
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : 3005;
})();

const BOOTED_AT = Date.now();
const SERVICE_VERSION = '0.1.0-mini';

// ---------- helpers ----------
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    if (typeof body !== 'object' || body === null) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ---------- routes ----------
async function handleSetup(req: Request): Promise<Response> {
  const b = await readJsonBody(req);
  if (!b) return json({ ok: false, error: 'Body phải là JSON' }, 400);
  const hubUrlRaw = typeof b.hub_url === 'string' ? b.hub_url.trim() : '';
  const workerIdRaw = typeof b.worker_id === 'string' ? b.worker_id.trim() : '';
  const secretRaw = typeof b.worker_secret === 'string' ? b.worker_secret : '';

  if (!hubUrlRaw) return json({ ok: false, error: 'Thiếu hub_url' }, 400);
  const urls = parseHubUrl(hubUrlRaw);
  if (!urls) {
    return json(
      {
        ok: false,
        error:
          'hub_url không hợp lệ — dùng URL công cộng của hub, ví dụ https://preview-xxx.space-z.ai/?XTransformPort=3003',
      },
      400,
    );
  }
  if (!isValidWorkerId(workerIdRaw)) {
    return json(
      { ok: false, error: 'worker_id không hợp lệ (1–64 ký tự: chữ, số, dấu . _ -)' },
      400,
    );
  }
  if (!secretRaw || secretRaw.length < 8 || secretRaw.length > 256) {
    return json(
      { ok: false, error: 'worker_secret trống hoặc độ dài không hợp lệ (8–256)' },
      400,
    );
  }

  const fileConfig = { hub_url: hubUrlRaw, worker_id: workerIdRaw, worker_secret: secretRaw };
  try {
    await writeFileConfig(fileConfig);
  } catch (err) {
    log('error', 'setup: write config file failed', { error: errMsg(err) });
    return json({ ok: false, error: `Không ghi được config file: ${errMsg(err)}` }, 500);
  }

  try {
    const workerConfig = await fileConfigToWorkerConfig(fileConfig);
    stopRuntime(); // dọn runtime cũ (nếu có) — startRuntime tự guard singleton
    startRuntime(workerConfig, 'ui-setup');
  } catch (err) {
    log('error', 'setup: start runtime failed', { error: errMsg(err) });
    return json({ ok: false, error: `Không start được runtime: ${errMsg(err)}` }, 500);
  }

  log('info', 'setup: config saved — runtime starting', {
    worker_id: workerIdRaw,
    hub_url: hubUrlRaw,
    hub_ws_url: urls.hubUrl,
    hub_token_url: urls.hubTokenUrl,
  });
  return json({ ok: true });
}

async function handleDisconnect(): Promise<Response> {
  try {
    stopRuntime();
    await deleteFileConfig();
    log('info', 'disconnect: runtime stopped + config file removed');
    return json({ ok: true });
  } catch (err) {
    log('error', 'disconnect failed', { error: errMsg(err) });
    return json({ ok: false, error: errMsg(err) }, 500);
  }
}

async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return json({ ok: true });

  if (req.method === 'GET' && path === '/') {
    return json({
      ok: true,
      service: 'zaiwebhub-worker',
      kind: 'mini-service (bun)',
      version: SERVICE_VERSION,
      protocol_version: PROTOCOL_VERSION,
      uptime_sec: Math.round((Date.now() - BOOTED_AT) / 1000),
      hostname: getHostname(),
      endpoints: ['/api/health', '/api/status', '/api/setup', '/api/disconnect'],
      note: 'UI worker nằm ở main app :3000 — fetch qua ?XTransformPort=3005',
    });
  }

  if (req.method === 'GET' && path === '/api/health') {
    // Shape GIỐNG NGUYÊN /api/health gốc của repo (ops script đang dựa vào nó).
    return json(getWorkerStatus());
  }

  if (req.method === 'GET' && path === '/api/status') {
    return json(await buildStatusPayload());
  }

  if (req.method === 'POST' && path === '/api/setup') {
    return await handleSetup(req);
  }

  if (req.method === 'POST' && path === '/api/disconnect') {
    return await handleDisconnect();
  }

  return json({ ok: false, error: `Not found: ${req.method} ${path}` }, 404);
}

// ---------- server ----------
const server = Bun.serve({
  port: PORT,
  fetch: async (req) => {
    try {
      return await route(req);
    } catch (err) {
      log('error', 'unhandled route error', { error: errMsg(err) });
      return json({ ok: false, error: 'internal error' }, 500);
    }
  },
});

log('info', 'worker mini-service listening', {
  port: server.port,
  version: SERVICE_VERSION,
  protocol_version: PROTOCOL_VERSION,
  gateway: 'UI fetch qua ?XTransformPort=' + String(PORT),
});

// ---------- boot runtime (singleton) ----------
void (async () => {
  try {
    const { resolveBootConfig } = await import('./src/file-config');
    const boot = await resolveBootConfig();
    if (!boot) {
      log('info', 'no worker config (env + worker-config.json) — SETUP UI mode, WS not started');
      return;
    }
    const { startRuntime } = await import('./src/ws-client');
    startRuntime(boot.config, boot.source);
  } catch (err) {
    log('error', 'boot failed', { error: errMsg(err) });
  }
})();

// Graceful shutdown — giữ behavior sạch khi sandbox restart process.
process.on('SIGTERM', () => {
  log('info', 'SIGTERM — stopping runtime + server');
  stopRuntime();
  server.stop(true);
  process.exit(0);
});
process.on('SIGINT', () => {
  log('info', 'SIGINT — stopping runtime + server');
  stopRuntime();
  server.stop(true);
  process.exit(0);
});
