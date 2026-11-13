// apps/dev-console — /api/workers (3.6-H + 4.0-W)
// Server-side proxy tới webhub GET /internal/workers (:3003).
// WORKER_SECRET CHỈ tồn tại ở server — không bao giờ trả secret về client.
// 4.0-W: đọc secret ĐỘNG từ runtime file (.runtime/worker-secret.json) ưu tiên env —
// owner xoay secret trên web → proxy dùng giá trị mới NGAY, không restart console.
// Client poll route này mỗi 5s ở tab /workers và /stats.
import { getWorkerSecretInfo } from '@/lib/worker-secret-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_INTERNAL_URL = process.env.HUB_INTERNAL_URL ?? 'http://127.0.0.1:3003';

export async function GET(): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const { secret } = await getWorkerSecretInfo();
  if (secret) {
    headers['x-worker-secret'] = secret;
  }
  try {
    const res = await fetch(`${HUB_INTERNAL_URL}/internal/workers`, {
      headers,
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
          message: `hub không phản hồi tại ${HUB_INTERNAL_URL}/internal/workers — kiểm tra webhub :3003 đã chạy chưa (${String(err)})`,
        },
      },
      { status: 502 },
    );
  }
}
