// apps/dev-console — /api/worker-secret (3.6-H + 4.0-W)
// Cho phép owner XEM + TẠO/XOAY WORKER_SECRET ngay trên Hub UI (tab /workers → box Worker
// Connection Info) thay vì phải sửa .env.local + restart service.
//
// GET  → resolve secret hiện tại: runtime file .runtime/worker-secret.json ưu tiên,
//        fallback env WORKER_SECRET (cách cũ). Trả { set, worker_secret, source, hint }.
// POST → { value?: string } — value rỗng/thiếu → tự sinh ngẫu nhiên 256-bit (64 hex).
//        Ghi runtime file + đồng bộ .env.local + worker-config.json của worker local.
//        Hub (:3003) + worker local (:3005) đọc lại file runtime MỖI LẦN CẦN → áp dụng NGAY,
//        KHÔNG cần restart service nào.
//
// Mô hình bảo mật (đã chốt ở task 3.6-H): UI không có auth riêng — lớp bảo vệ là public
// preview URL của sandbox chỉ owner truy cập được. Route không bao giờ log secret.
// Client tự mask (hiện •••• + 4 ký tự cuối) cho tới khi bấm reveal.
import {
  generateWorkerSecret,
  getWorkerSecretInfo,
  saveWorkerSecret,
  validateCustomSecret,
} from '@/lib/worker-secret-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const info = await getWorkerSecretInfo();
  return Response.json(
    {
      set: Boolean(info.secret),
      worker_secret: info.secret,
      source: info.source,
      hint: info.secret
        ? info.source === 'runtime-file'
          ? 'Đã tạo từ web — worker fetch /internal/worker-token với header X-Worker-Secret = giá trị này.'
          : 'Worker fetch /internal/worker-token với header X-Worker-Secret = giá trị này.'
        : 'WORKER_SECRET chưa set — bấm "Tạo secret mới" để tạo ngay trên web (không cần restart).',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}

interface SaveResponse {
  ok: boolean;
  worker_secret?: string;
  fingerprint?: string;
  env_local_updated?: boolean;
  worker_config_updated?: boolean;
  error?: { message: string };
}

export async function POST(req: Request): Promise<Response> {
  let value = '';
  try {
    const body = (await req.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const rec = body as Record<string, unknown>;
      if (typeof rec.value === 'string') value = rec.value.trim();
    }
  } catch {
    // body rỗng / không JSON → coi như "generate"
  }

  const custom = value.length > 0;
  if (custom) {
    const err = validateCustomSecret(value);
    if (err) {
      const res: SaveResponse = { ok: false, error: { message: err } };
      return Response.json(res, { status: 400 });
    }
  }

  const secret = custom ? value : generateWorkerSecret();
  try {
    const saved = await saveWorkerSecret(secret);
    // KHÔNG log secret nguyên văn — chỉ fingerprint để đối chiếu trong log server nếu cần.
    const res: SaveResponse = {
      ok: true,
      worker_secret: saved.secret,
      fingerprint: saved.fingerprint,
      env_local_updated: saved.env_local_updated,
      worker_config_updated: saved.worker_config_updated,
    };
    return Response.json(res, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const res: SaveResponse = {
      ok: false,
      error: { message: `Không ghi được secret: ${String(err)}` },
    };
    return Response.json(res, { status: 500 });
  }
}
