# ZaiWebHub — 1-repo Sandbox Edition

Worker pool phân tán cho Z.AI sandbox: **hub + console + worker gom về MỘT repo, MỘT dự án
Next.js duy nhất** — clone về là chạy, không trắng trang trên prod.

> Phiên bản gốc (monorepo 3 app riêng: `apps/webhub` + `apps/dev-console` + `apps/worker`)
> được bảo toàn ở branch [`backup/original-monorepo`](../../tree/backup/original-monorepo).
> Bản này consolidate toàn bộ về cấu trúc sandbox-template của Z.AI vì chỉ có cấu trúc đó
> chạy đúng trên prod (chi tiết ở [docs/deploy/60-one-repo-sandbox.md](docs/deploy/60-one-repo-sandbox.md)).

## Kiến trúc

```
Owner browser ──▶ https://<sandbox-host>/          main app Next.js :3000 (Hub UI 5 tab, route "/" duy nhất)
                     │  fetch RELATIVE + ?XTransformPort=<port> (qua Caddy gateway)
                     ├──▶ hub  mini-service (Bun) :3003   — registry + dispatch + relay SSE byte-blind
                     └──▶ worker mini-service (Bun) :3005 — outbound WS tới hub, gọi zsdk, stream về
                                │
                                └──▶ Z.AI upstream (zsdk /etc/.z-ai-config — mode proxy, không cần key)
```

- **Main app :3000** — Hub UI 5 tab client-side trên 1 route `/` duy nhất:
  `Console` (chat SSE 3 mode: mock / adapter / webhub E2E) · `Workers` (pool + Connection Info) ·
  `Stats` · `Docs` (API ref kiểu OpenAI) · `Worker node` (dashboard worker cục bộ).
- **mini-services/hub :3003** — hub thật (port từ `apps/webhub`): Hono + WS upgrade `/worker`,
  mint worker token HMAC, least-loaded dispatch, heartbeat sweep 45s. Chạy Bun.
- **mini-services/worker :3005** — worker runtime (outbound-only WS, không cần inbound),
  nhận `job.dispatch` → gọi zsdk server-side → relay SSE bytes nguyên xi về hub. Chạy Bun.

## Chạy trong sandbox

```bash
bun install                     # deps main app
bun run dev                     # Next.js :3000 (dev server chính)

# 2 mini-service (mỗi cái 1 terminal riêng hoặc nohup):
cd mini-services/hub    && bun install && bun run dev
cd mini-services/worker && bun run dev
```

Mở preview panel → trang chủ là Hub UI. Thiết lập nhanh E2E trên MỘT sandbox:

1. Tab **Worker node** → paste Hub URL = public URL của sandbox này
   (`https://<host>/?XTransformPort=3003`) + Worker ID + Worker Secret (xem `.env.example`) → Connect.
2. Tab **Workers** → thấy worker `online`.
3. Tab **Console** → mode **WebHub (E2E)** → chat — stream SSE thật đi qua hub ↔ worker.

## Env (tất cả optional — có default dev)

| Biến | Service | Mặc định | Ý nghĩa |
|---|---|---|---|
| `TENANT_KEYS` | hub | `zhb_dev_default_key` | Bearer keys cho `/v1/*` (phân tách phẩy) |
| `WEBHUB_SECRET` | hub | dev default | HMAC signing secret cho worker token |
| `WORKER_SECRET` | hub + console | (không set) | Gate `/internal/worker-token` (header `X-Worker-Secret`). **Không set = dev mode KHÔNG gate — không expose công khai.** |
| `PORT` | hub | `3003` | Port listen của hub |
| `WORKER_PORT` | worker | `3005` | Port listen của worker service |
| `HUB_INTERNAL_URL` | console | `http://127.0.0.1:3003` | Hub nội bộ cho proxy `/api/workers` |

Set env cho mini-service bằng file `.env` trong thư mục của nó hoặc export trước khi chạy.
`WORKER_SECRET` phải giống nhau giữa hub và các worker; console cần nó để hiển thị Connection
Info trên tab Workers. **Không bao giờ commit giá trị secret.**

## Quy tắc sandbox (bắt buộc đọc)

- Chỉ port **3000** được expose mặc định qua Caddy gateway. Mọi service khác port **phải** fetch
  bằng RELATIVE URL + query `?XTransformPort=<port>` — **cấm** ghi port/host tuyệt đối vào URL.
- User chỉ thấy **1 route `/`** → toàn bộ UI là tab client-side, không dùng `next/link`.
- `next.config.ts` có `allowedDevOrigins` (`.space-z.ai`) — thiếu nó Next 16 chặn HMR → **trắng trang**.
- `next.config.ts` có rewrite `/v1/chat/completions` → `127.0.0.1:3003` cho ngữ cảnh truy cập
  trực tiếp (không qua gateway); qua gateway thì `XTransformPort` tự forward.
- zsdk (`z-ai-web-dev-sdk`) **chỉ chạy backend** — adapter mode + worker mini-service đều server-side.

## Cấu trúc

```
src/
  app/page.tsx                  # Hub UI 5 tab (route "/" duy nhất)
  app/api/{mock-chat,adapter-chat,workers,worker-secret}/route.ts
  lib/protocol/                 # vendored từ packages/protocol (wire contract FROZEN)
  lib/zai-adapter/              # vendored từ packages/zai-adapter (zsdk → SSE chuẩn hóa)
  lib/{endpoints,sse-client,chat-*,hub-workers,api-docs}.ts
  components/{chat,docs,hub,worker}/
mini-services/
  hub/                          # webhub :3003 — Bun mini-service (src/ port từ apps/webhub)
  worker/                       # worker runtime :3005 — Bun mini-service
docs/
  api.md                        # wire contract (nguồn sự thật cho tab Docs)
  deploy/                       # runbook từng vai trò + 60-one-repo-sandbox.md (bản này)
PLANS.md                        # lịch sử thiết kế (monorepo gốc)
```

## Xác minh đã chạy (sandbox này)

| Loop | Kết quả |
|---|---|
| Hub :3003 boot + healthz | PASS |
| Worker :3005 register WS → hub (outbound-only) | PASS — `worker registered` |
| Console WebHub mode E2E (rewrite → hub → worker → zsdk → SSE relay → `[DONE]`) | PASS |
| Adapter mode (zsdk server-side trực tiếp) | PASS |
| Mock mode (wire contract `reasoning_content` → `content` → `[DONE]`) | PASS |
| `/api/workers` proxy giữ secret server-side | PASS |
| Lint | PASS |
