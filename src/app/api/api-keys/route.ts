// apps/dev-console — /api/api-keys (4.2-K)
// Server-side proxy tới webhub /internal/api-keys (:3003) — quản lý Bearer key `zhb_*`
// owner phát hành cho client BÊN NGOÀI gọi /v1/chat/completions.
// WORKER_SECRET (gate X-Worker-Secret) CHỈ tồn tại ở server — không bao giờ xuống client.
// Key NGUYÊN VĂN chỉ xuất hiện ĐÚNG 1 LẦN ở response POST (client tự hiện dialog reveal-once);
// mọi GET list chỉ chứa prefix mask + metadata, không có hash/key plain.
//
//   GET    → proxy GET  /internal/api-keys
//   POST   → proxy POST /internal/api-keys   body { name?: string }
//   DELETE → proxy DEL  /internal/api-keys?id=…
import { getWorkerSecretInfo } from '@/lib/worker-secret-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_INTERNAL_URL = process.env.HUB_INTERNAL_URL ?? 'http://127.0.0.1:3003';

async function hubProxy(path: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init?.body ? { 'content-type': 'application/json' } : {}),
  };
  const { secret } = await getWorkerSecretInfo();
  if (secret) {
    headers['x-worker-secret'] = secret;
  }
  try {
    const res = await fetch(`${HUB_INTERNAL_URL}${path}`, {
      ...init,
      headers: { ...init?.headers, ...headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return Response.json(
      {
        error: {
          message: `hub không phản hồi tại ${HUB_INTERNAL_URL}${path} — kiểm tra webhub :3003 đã chạy chưa (${String(err)})`,
        },
      },
      { status: 502 },
    );
  }
}

export async function GET(): Promise<Response> {
  return hubProxy('/internal/api-keys');
}

export async function POST(req: Request): Promise<Response> {
  let payload = '{}';
  try {
    const body = (await req.json()) as unknown;
    if (typeof body === 'object' && body !== null) {
      const name = (body as Record<string, unknown>).name;
      payload = JSON.stringify({ name: typeof name === 'string' ? name : '' });
    }
  } catch {
    // body rỗng → hub tự đặt tên mặc định
  }
  return hubProxy('/internal/api-keys', { method: 'POST', body: payload });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  return hubProxy(`/internal/api-keys?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
}
