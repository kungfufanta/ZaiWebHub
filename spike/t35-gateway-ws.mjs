// T3.5 spike — dress rehearsal remote worker QUA GATEWAY (localhost:81 + XTransformPort=3003).
// Mô phỏng ĐÚNG flow mà worker ở sandbox khác sẽ thực hiện với hub công khai:
//   [1] GET {origin}/internal/worker-token?XTransformPort=3003  + header X-Worker-Secret
//   [2] WS {origin}/worker?XTransformPort=3003 → gửi worker.register với token vừa mint
//   [3] PASS nếu: token 200 + WS open + KHÔNG bị close 4401 trong 3s + heartbeat gửi OK.
// Chạy: node spike/t35-gateway-ws.mjs   (env: WORKER_SECRET, WORKER_ID, GATEWAY_ORIGIN)
// Negative test: WORKER_SECRET=wrong → phải FAIL ở bước [1] với HTTP 401.
import { setTimeout as sleep } from 'node:timers/promises';

const SECRET = process.env.WORKER_SECRET ?? '';
const WORKER_ID = process.env.WORKER_ID ?? `spike-remote-${Math.random().toString(36).slice(2, 8)}`;
const ORIGIN = (process.env.GATEWAY_ORIGIN ?? 'http://localhost:81').replace(/\/+$/, '');
const TOKEN_URL = `${ORIGIN}/internal/worker-token?XTransformPort=3003`;
const WS_URL = `${ORIGIN.replace(/^http/, 'ws')}/worker?XTransformPort=3003`;

console.log(`[0] gateway origin = ${ORIGIN} | secret_set = ${SECRET.length > 0} | worker_id = ${WORKER_ID}`);

// [1] token fetch
const t0 = Date.now();
const headers = SECRET ? { 'X-Worker-Secret': SECRET } : {};
const res = await fetch(TOKEN_URL, { headers });
console.log(`[1] token fetch: HTTP ${res.status} (${Date.now() - t0}ms)`);
if (!res.ok) {
  const errBody = await res.text().catch(() => '');
  console.error(`FAIL: token fetch HTTP ${res.status} ${errBody.slice(0, 120)}`);
  process.exit(1);
}
const body = await res.json();
const token = body.token ?? '';
console.log(`[2] token minted (len=${token.length}, prefix=${token.slice(0, 8)}…)`);

// [2] WS register
const ws = new WebSocket(WS_URL);
let rejected = false;
ws.onopen = () => {
  console.log(`[3] WS open: ${WS_URL}`);
  ws.send(
    JSON.stringify({
      type: 'worker.register',
      capabilities: {
        worker_id: WORKER_ID,
        tenant_id: 'default',
        models: ['glm-5.3'],
        concurrency: 1,
        protocol_version: 1,
        version: 'spike-t35',
      },
      token,
    }),
  );
  console.log('[4] worker.register sent — chờ 3s xem hub có close 4401 không…');
};
ws.onmessage = (ev) => {
  console.log('[hub frame]', typeof ev.data === 'string' ? ev.data.slice(0, 200) : '(binary)');
};
ws.onclose = (ev) => {
  console.log(`[ws close] code=${ev.code} reason=${ev.reason || '(none)'}`);
  if (ev.code === 4401) rejected = true;
};
ws.onerror = (ev) => console.log('[ws error]', ev.message ?? '(error event)');

await sleep(3000);
if (rejected) {
  console.error('FAIL: register bị hub từ chối (4401)');
  process.exit(1);
}
if (ws.readyState !== 1) {
  console.error('FAIL: WS không giữ được kết nối mở');
  process.exit(1);
}
// [3] heartbeat thử 1 nhịp
ws.send(JSON.stringify({ type: 'worker.heartbeat', ts: Date.now(), inflight: 0 }));
await sleep(1500);
if (ws.readyState !== 1) {
  console.error('FAIL: socket đóng sau heartbeat');
  process.exit(1);
}
console.log(`PASS: remote-worker register qua gateway OK (${WORKER_ID}) — hub chấp nhận, heartbeat OK`);
try {
  ws.close(1000);
} catch {
  /* ignore */
}
process.exit(0);
