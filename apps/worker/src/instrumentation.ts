// T2-a se khoi dong WS client outbound toi HUB_URL tai day (khoi dong 1 lan khi boot, KHONG phai trong request handler).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // dynamic import se them o T2-a; giu stub de tranh chan build
  }
}
