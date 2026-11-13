// apps/worker — GET /api/health (T2-a): báo trạng thái WS client / executor cho dev + ops.
import { getWorkerStatus } from '../../../worker/ws-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const status = getWorkerStatus();
  return Response.json({
    ok: true,
    service: 'worker',
    ...status,
  });
}
