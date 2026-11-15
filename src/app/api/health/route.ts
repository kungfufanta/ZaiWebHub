// GET /api/health (4.4-D) — self-health CỦA CONSOLE, luôn 200, không gọi ra ngoài.
// Vì sao cần: trước đây /api/health bị rewrite thẳng sang worker :3005 — runner deploy
// probe health khi worker chưa sống → 500 → deploy bị đánh dấu FAILED ("Failed" page).
// Rewrite giờ chỉ kích hoạt khi URL có query XTransformPort (xem next.config.ts), còn
// đường không-query này trả lời bằng chính console. Trạng thái hub/worker xem qua
// /api/workers (proxy có secret) hoặc tab Workers / Worker node trên UI.
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
