// apps/worker — POST /api/disconnect (Task 3.6-W)
// Dừng WS runtime (không kill process) + xoá .worker-config.json → reload / sẽ thấy setup form.
import { deleteFileConfig } from '../../../worker/file-config';
import { stopRuntime } from '../../../worker/ws-client';
import { errMsg, log } from '../../../worker/util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    stopRuntime();
    await deleteFileConfig();
    log('info', 'disconnect: runtime stopped + config file deleted');
    return Response.json({ ok: true });
  } catch (err) {
    log('error', 'disconnect failed', { error: errMsg(err) });
    return Response.json({ ok: false, error: errMsg(err) }, { status: 500 });
  }
}
