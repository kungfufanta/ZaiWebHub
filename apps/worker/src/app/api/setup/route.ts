// apps/worker — POST /api/setup (Task 3.6-W)
// Body: { hub_url, worker_id, worker_secret }
// Validate → ghi .worker-config.json (gitignored) → khởi động WS runtime (singleton, chống double connect).
// KHÔNG bao giờ log/echo worker_secret. Trả { ok: true } hoặc { ok: false, error }.
import {
  fileConfigToWorkerConfig,
  isValidWorkerId,
  parseHubUrl,
  writeFileConfig,
} from '../../../worker/file-config';
import { startRuntime, stopRuntime } from '../../../worker/ws-client';
import { errMsg, log } from '../../../worker/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'Body phải là JSON' }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const hubUrlRaw = typeof b.hub_url === 'string' ? b.hub_url.trim() : '';
  const workerIdRaw = typeof b.worker_id === 'string' ? b.worker_id.trim() : '';
  const secretRaw = typeof b.worker_secret === 'string' ? b.worker_secret : '';

  if (!hubUrlRaw) {
    return Response.json({ ok: false, error: 'Thiếu hub_url' }, { status: 400 });
  }
  const urls = parseHubUrl(hubUrlRaw);
  if (!urls) {
    return Response.json(
      {
        ok: false,
        error:
          'hub_url không hợp lệ — dùng URL công cộng của hub, ví dụ https://preview-xxx.space-z.ai/?XTransformPort=3003',
      },
      { status: 400 },
    );
  }
  if (!isValidWorkerId(workerIdRaw)) {
    return Response.json(
      { ok: false, error: 'worker_id không hợp lệ (1–64 ký tự: chữ, số, dấu . _ -)' },
      { status: 400 },
    );
  }
  if (!secretRaw || secretRaw.length < 8 || secretRaw.length > 256) {
    return Response.json(
      { ok: false, error: 'worker_secret trống hoặc độ dài không hợp lệ (8–256)' },
      { status: 400 },
    );
  }

  const fileConfig = { hub_url: hubUrlRaw, worker_id: workerIdRaw, worker_secret: secretRaw };
  try {
    await writeFileConfig(fileConfig);
  } catch (err) {
    log('error', 'setup: write config file failed', { error: errMsg(err) });
    return Response.json({ ok: false, error: `Không ghi được config file: ${errMsg(err)}` }, { status: 500 });
  }

  try {
    const workerConfig = await fileConfigToWorkerConfig(fileConfig);
    stopRuntime(); // dọn runtime cũ (nếu có) — startRuntime tự guard singleton
    startRuntime(workerConfig, 'ui-setup');
  } catch (err) {
    log('error', 'setup: start runtime failed', { error: errMsg(err) });
    return Response.json({ ok: false, error: `Không start được runtime: ${errMsg(err)}` }, { status: 500 });
  }

  log('info', 'setup: config saved — runtime starting', {
    worker_id: workerIdRaw,
    hub_url: hubUrlRaw,
    hub_ws_url: urls.hubUrl,
    hub_token_url: urls.hubTokenUrl,
  });
  return Response.json({ ok: true });
}
