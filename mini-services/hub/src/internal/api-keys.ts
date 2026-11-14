// apps/webhub — internal/api-keys.ts (4.2-K)
// Quản lý Bearer key `zhb_*` cho client BÊN NGOÀI gọi /v1/* — owner tạo/thu hồi NGAY TRÊN WEB
// (console :3000 → /api/api-keys proxy sang đây), không cần sửa env TENANT_KEYS + restart hub.
//
//   GET    /internal/api-keys        → { keys: ApiKeyPublic[], env_key_count, env_keys_preview }
//   POST   /internal/api-keys        → body { name?: string } → { key (NGUYÊN VĂN — 1 lần), record }
//   DELETE /internal/api-keys?id=ak_…→ { ok, removed_id }
//
// Auth: header X-Worker-Secret — CÙNG gate với /internal/workers + /internal/worker-token
// (Đợt 3.5 + 4.0-W). Sai/thiếu → 401. Key plain KHÔNG BAO GIỜ log; list chỉ trả prefix mask.
// Key env legacy (TENANT_KEYS) chỉ ĐẾM + preview mask — không thêm/sửa được qua endpoint này.
import { Hono } from 'hono';
import { getTenantKeys, isWorkerSecretRequired, matchesWorkerSecret } from '../auth';
import { log } from '../logger';
import {
  createRuntimeApiKey,
  getRuntimeApiKeys,
  revokeRuntimeApiKey,
} from '../runtime-api-keys';

const NAME_MAX = 64;

export function createInternalApiKeysRouter(): Hono {
  const router = new Hono();

  // Gate X-Worker-Secret cho toàn bộ /internal/api-keys* (giống /internal/workers)
  router.use('/internal/api-keys*', async (c, next) => {
    const provided = c.req.header('X-Worker-Secret');
    if ((await isWorkerSecretRequired()) && !(await matchesWorkerSecret(provided))) {
      log('warn', 'internal/api-keys refused: missing/wrong X-Worker-Secret', {
        forwarded_for: c.req.header('X-Forwarded-For') ?? 'unknown',
        path: c.req.path,
      });
      return c.json(
        { error: { message: 'worker secret required (header X-Worker-Secret)' } },
        401,
      );
    }
    await next();
  });

  router.get('/internal/api-keys', async (c) => {
    const keys = await getRuntimeApiKeys();
    const envKeys = getTenantKeys();
    return c.json({
      keys,
      env_key_count: envKeys.length,
      env_keys_preview: envKeys.map((k) => `${k.slice(0, 12)}…`),
    });
  });

  router.post('/internal/api-keys', async (c) => {
    let name = '';
    try {
      const body = (await c.req.json()) as unknown;
      if (typeof body === 'object' && body !== null) {
        const rec = body as Record<string, unknown>;
        if (typeof rec.name === 'string') name = rec.name.trim();
      }
    } catch {
      // body rỗng / không JSON → dùng tên mặc định
    }
    if (name.length > NAME_MAX) {
      return c.json({ error: { message: `tên key quá dài (tối đa ${NAME_MAX} ký tự)` } }, 400);
    }
    try {
      const { key, record } = await createRuntimeApiKey(name);
      return c.json({ key, record }, 201);
    } catch (err) {
      return c.json({ error: { message: String(err) } }, 409);
    }
  });

  router.delete('/internal/api-keys', async (c) => {
    const id = c.req.query('id') ?? '';
    if (!id) {
      return c.json({ error: { message: 'thiếu query param id' } }, 400);
    }
    const removed = await revokeRuntimeApiKey(id);
    if (!removed) {
      return c.json({ error: { message: `không tìm thấy key ${id}` } }, 404);
    }
    return c.json({ ok: true, removed_id: id });
  });

  return router;
}
