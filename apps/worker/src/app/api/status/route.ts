// apps/worker — GET /api/status (Task 3.6-W)
// Trạng thái đầy đủ cho status dashboard (poll mỗi 3s). KHÔNG trả worker_secret bao giờ.
import { buildStatusPayload } from '../../../worker/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const payload = await buildStatusPayload();
  return Response.json(payload);
}
