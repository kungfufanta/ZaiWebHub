# Runbook CONSOLE agent (Task ID: 3.5-C)

> Mục tiêu: UI chat (apps/dev-console) để owner dùng hub.
> 2 phương án — mặc định dùng Phương án A (đã LIVE trên hub sandbox).

## Phương án A — console chạy TRÊN hub sandbox, port :3000 (khuyến nghị, đã vận hành)

Hub sandbox hiện đã chạy sẵn: console `:3000` + hub `:3003` + worker nội bộ `:3004`.
Owner mở public URL của hub sandbox → thấy UI → chọn mode **WebHub (E2E)** → chat.
Không cần làm gì thêm. Việc của C: theo dõi Loop 3/5, ghi COORDINATION.md, polish UI nếu owner yêu cầu.

Cơ chế (đã verify):
- Browser mở `https://<hub-host>/` → gateway (default route) → console :3000.
- Console WebHub mode fetch relative `/v1/chat/completions?XTransformPort=3003` → gateway → hub :3003.
- Truy cập TRỰC TIẾP `:3000` (không qua gateway) → Next rewrite server-side → `http://localhost:3003` (hub cùng sandbox).
- CORS đã bật ở hub `/v1/*` (cho phép cross-origin nếu cần).

## Phương án B — console trên sandbox RIÊNG (nếu owner muốn tách)

```bash
git clone https://github.com/kungfufanta/ZaiWebHub.git && cd ZaiWebHub
bun install
cd apps/dev-console
export NEXT_PUBLIC_WEBHUB_URL='https://<hub-host>'
export NEXT_PUBLIC_WEBHUB_QUERY='?XTransformPort=3003'
export WEBHUB_ORIGIN='https://<hub-host>'
export WEBHUB_QUERY='?XTransformPort=3003'
bun run scripts/build-compat.ts
( nohup node node_modules/.bin/next dev -p 3000 > console.log 2>&1 < /dev/null & )
```

- `NEXT_PUBLIC_*` inline lúc dev-boot → **phải restart console sau khi đổi env**.
- Client fetch absolute `${NEXT_PUBLIC_WEBHUB_URL}/v1/chat/completions${NEXT_PUBLIC_WEBHUB_QUERY}` (CORS hub đã mở).
- Rewrite server-side `${WEBHUB_ORIGIN}/v1/chat/completions${WEBHUB_QUERY}` làm fallback.
- Owner mở public URL của sandbox console.

## Verify (Loop 3)

1. Mở UI → mode **WebHub (E2E)** → gửi prompt ngắn.
2. Nhận stream: nội dung trả lời, badge `no-reasoning (proxy)`, job_id hiển thị, đúng 1 `[DONE]`.
3. Ghi COORDINATION.md: TTFB, số event, worker nào nhận job (hub log), commit `docs(coord): C loop3 PASS`.

## Onboard worker mới (3.6-H — làm trên Hub UI)

1. Owner mở public URL sandbox hub `:3000` → nav **Workers**.
2. Trong box **Worker Connection Info**: paste **HUB PUBLIC BASE URL** (public URL của sandbox hub, vd `https://<hub-host>`) → UI sinh URL dạng:
   `{HUB_PUBLIC_BASE}/internal/worker-token?XTransformPort=3003`
3. Bấm **Copy URL**.
4. Mở worker sandbox → `:3000` → paste URL này + secret (`WORKER_SECRET` do owner cấp qua chat) vào form setup của worker.
5. Tab Workers poll 5s — worker mới hiện badge **online** kèm inflight/total_jobs/heartbeat; tab **Stats** thấy số jobs tăng.

## Điểm chú ý UI

- Panel thinking TỰ ĐỘNG: chỉ hiện khi stream có `delta.reasoning_content` — proxy sandbox luôn strip →
  không hiện là ĐÚNG thiết kế (F7), không fix gì cả.
- Không đổi interface `packages/protocol`. Không tự chế event name.
