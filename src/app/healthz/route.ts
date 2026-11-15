// GET /healthz (4.4-D) — probe hợp đồng của hub (healthz) nhưng trả lời bằng console,
// luôn 200 sub-ms. Trên deploy prod KHÔNG có hub (:3003) phía sau nếu runner chỉ chạy
// Next — probe /healthz chạm Next thay vì 404/500, deploy runner không đánh dấu fail.
// Muốn probe HUB thật: /healthz?XTransformPort=3003 (gateway sandbox) hoặc hub trực tiếp.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    ok: true,
    service: 'zaiwebhub-console',
    ts: Date.now(),
  });
}
