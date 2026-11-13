// apps/dev-console — /api/worker-secret (3.6-H follow-up)
// Cho phép owner LẤY WORKER_SECRET ngay trên Hub UI (tab /workers → box Worker Connection
// Info) thay vì phải tra lại chat. Giá trị đọc từ env của console (server-side) — phải khớp
// env WORKER_SECRET của webhub :3003.
//
// Mô hình bảo mật (đã chốt ở task 3.6-H): UI không có auth riêng — lớp bảo vệ là public
// preview URL của sandbox chỉ owner truy cập được. Route không bao giờ log secret.
// Client tự mask (hiện •••• + 4 ký tự cuối) cho tới khi bấm reveal.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const secret = process.env.WORKER_SECRET;
  return Response.json(
    {
      set: Boolean(secret),
      worker_secret: secret ?? null,
      hint: secret
        ? 'Worker fetch /internal/worker-token với header X-Worker-Secret = giá trị này.'
        : 'WORKER_SECRET chưa set trong env console — hãy set vào .env.local rồi restart console.',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
