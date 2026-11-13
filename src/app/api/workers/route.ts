// apps/dev-console — /api/workers (3.6-H)
// Server-side proxy tới webhub GET /internal/workers (:3003).
// WORKER_SECRET CHỈ tồn tại ở server (env) — không bao giờ trả secret về client.
// Client poll route này mỗi 5s ở tab /workers và /stats.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HUB_INTERNAL_URL = process.env.HUB_INTERNAL_URL ?? 'http://127.0.0.1:3003';

export async function GET(): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (process.env.WORKER_SECRET) {
    headers['x-worker-secret'] = process.env.WORKER_SECRET;
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
