// src/instrumentation.ts (4.0-W / 4.4-P)
// Next.js instrumentation — chạy 1 lần lúc server boot (nodejs runtime), cả dev lẫn prod.
// Khởi động service supervisor: tự spawn lại hub :3003 / worker :3005 nếu chúng không phản hồi
// (platform chỉ giữ process có parent sống — console Next.js là parent bền vững của cả hai).
// 4.4-P: supervisor tự tìm root repo (walk-up từ cwd — đúng cả khi standalone prod chdir vào
// .next/standalone; override bằng WEBHUB_ROOT) và gate theo layout repo, không còn phụ thuộc
// thư mục runtime .zscripts (gitignored → deploy mới không có → supervisor tắt lặng lẽ).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // 4.4-D: try/catch bắt mọi lỗi supervisor — supervisor là tối ưu AVAILABILITY,
  // tuyệt đối KHÔNG được làm server fail-to-boot (fail ở đây = deploy "Failed").
  try {
    const { startServiceSupervisor } = await import('@/lib/hub-supervisor');
    startServiceSupervisor();
  } catch {
    /* bỏ qua — interval/probe sau vẫn tự hồi phục ở lần boot kế */
  }
}
