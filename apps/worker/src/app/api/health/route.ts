export async function GET() {
  return Response.json({
    ok: true,
    service: 'worker',
    mode: process.env.MODE ?? 'worker',
    hubUrl: process.env.HUB_URL ?? null,
  });
}
