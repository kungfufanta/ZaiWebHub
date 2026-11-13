// spike/t0b-ws-handshake.mjs — T0-b(c): WS outbound handshake từ sandbox (Node runtime per D1)
// Chạy: node spike/t0b-ws-handshake.mjs  (từ repo root)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const REMOTE_TARGETS = [
  'wss://ws.postman-echo.com/raw',
  'wss://echo.websocket.events',
  'wss://echo.websocket.org',
];

function probe(url, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    const out = { url, status: 'FAIL', detail: '', ms: 0 };
    const t0 = Date.now();
    let settled = false;
    let ws;
    const done = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      out.status = status; out.detail = detail; out.ms = Date.now() - t0;
      try { ws && ws.close(); } catch {}
      resolve(out);
    };
    const timer = setTimeout(() => done('FAIL', 'timeout ' + timeoutMs + 'ms'), timeoutMs);
    try { ws = new WebSocket(url); } catch (e) { done('FAIL', 'construct error: ' + e.message); return; }
    ws.onopen = () => { try { ws.send('t0b-ping'); } catch (e) { done('FAIL', 'send error: ' + e.message); } };
    ws.onmessage = (ev) => done('PASS', 'echo received: ' + String(ev.data).slice(0, 60));
    ws.onerror = (ev) => done('FAIL', (ev && (ev.message || (ev.error && ev.error.message))) || 'error event');
    ws.onclose = (ev) => { if (!settled) done('FAIL', 'closed before echo: code=' + (ev && ev.code) + ' reason=' + ((ev && ev.reason) || '')); };
  });
}

async function loopbackTest() {
  return new Promise((resolve) => {
    const out = { url: 'ws://127.0.0.1:3999 (loopback control)', status: 'FAIL', detail: '', ms: 0 };
    let settled = false; let wss; let client; let timer;
    const finish = (status, detail) => {
      if (settled) return; settled = true; clearTimeout(timer);
      out.status = status; out.detail = detail;
      try { wss && wss.close(); } catch {} try { client && client.close(); } catch {}
      resolve(out);
    };
    try {
      const WebSocketServer = require('ws').WebSocketServer;
      wss = new WebSocketServer({ host: '127.0.0.1', port: 3999 }, () => {
        client = new WebSocket('ws://127.0.0.1:3999');
        client.onopen = () => client.send('loopback-ping');
        client.onmessage = (ev) => finish('PASS', 'echo: ' + String(ev.data));
        client.onerror = (ev) => finish('FAIL', (ev && ev.message) || 'client error');
        client.onclose = () => { if (!settled) finish('FAIL', 'closed before echo'); };
      });
      wss.on('connection', (socket) => socket.on('message', (m) => socket.send(m.toString())));
      timer = setTimeout(() => finish('FAIL', 'timeout 8000ms'), 8000);
    } catch (e) { finish('FAIL', 'setup: ' + e.message); }
  });
}

console.log('== T0-b(c) WS outbound handshake — node ' + process.version + ' ==');
const results = [];
results.push(await loopbackTest());
for (const t of REMOTE_TARGETS) results.push(await probe(t));
for (const r of results) console.log(`  [${r.status}] ${r.url} (${r.ms}ms) ${r.detail}`);
const remotePass = results.filter((r) => r.url.startsWith('wss')).some((r) => r.status === 'PASS');
console.log('== VERDICT: outbound WS = ' + (remotePass ? 'PASS' : 'FAIL') + ' ==');
process.exit(remotePass ? 0 : 1);
