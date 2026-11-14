// src/instrumentation.ts (4.0-W)
// Next.js instrumentation — chạy 1 lần lúc server boot (nodejs runtime).
// Khởi động service supervisor: tự spawn lại hub :3003 / worker :3005 nếu chúng không phản hồi
// (sandbox chỉ giữ process có parent sống — console Next.js là parent bền vững của cả hai).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startServiceSupervisor } = await import('@/lib/hub-supervisor');
  startServiceSupervisor();
}
