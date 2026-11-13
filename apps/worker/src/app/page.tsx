// apps/worker — Next.js server component (Task 3.6-W)
// Điểm vào duy nhất của UI:
//   - chưa có config (env + file) → SETUP FORM (paste hub URL + secret → connect)
//   - có config → STATUS DASHBOARD (poll /api/status mỗi 3s)
import { getHostname, resolveBootConfig } from '../worker/file-config';
import { buildStatusPayload } from '../worker/status';
import SetupForm from '../components/setup-form';
import StatusDashboard from '../components/status-dashboard';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const boot = await resolveBootConfig();
  if (!boot) {
    const hostname = await getHostname();
    return <SetupForm defaultWorkerId={`w1-${hostname}`} />;
  }
  const initial = await buildStatusPayload();
  return <StatusDashboard initial={initial} />;
}
