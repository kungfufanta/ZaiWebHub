# 80 — Hướng dẫn chạy ZaiWebHub: trên sandbox hoặc VPS cá nhân

> Runbook chạy full stack (console web + hub + worker) ở 2 môi trường:
> **A. Sandbox platform space-z** (nơi repo này được sinh ra) và **B. VPS cá nhân**.
>
> Nguồn sự thật đi kèm:
> - `docs/api.md` — wire contract hub (:3003), auth, API keys, worker WS protocol.
> - `docs/deploy/70-sandbox-prod-pipeline.md` — pipeline deploy PROD của sandbox, quy ước code trên prod.
> - `.zscripts/` — tooling deploy của sandbox (đã commit vào repo, tự-heal sau re-provision).

---

## 0. Kiến trúc & quy ước chung (đọc trước khi chạy)

```
                    ┌────────────────────────── 1 máy / 1 container ──────────────────────────┐
Client web ──HTTP──▶│ Gateway (Caddy :81)                                                      │
Client API ──WS───▶│   ?XTransformPort=3003 ──▶ hub    (mini-services/hub,  Hono + WS)        │
                    │   ?XTransformPort=3005 ──▶ worker (mini-services/worker, Bun HTTP+WS-out)│
                    │   (không query)        ──▶ console Next.js :3000 (UI + proxy rewrite)    │
                    └──────────────────────────────────────────────────────────────────────────┘
                                        ▲                          ▲
                                        │ WS outbound (worker tự connect vào hub,
                                        │ hub KHÔNG BAO GIỜ inbound vào worker)
```

| Dịch vụ | Source | Port | Lệnh chạy | Health |
|---|---|---|---|---|
| Console (Next.js 16) | `src/` | **3000** | `bun run dev` / `bun .next/standalone/server.js` | `GET /api/health`, `GET /healthz` |
| Hub (Hono) | `mini-services/hub/index.ts` | **3003** = `HUB_INTERNAL_PORT` | `bun run dev` (trong thư mục service) | `GET /healthz` |
| Worker (Bun) | `mini-services/worker/index.ts` | **3005** = `WORKER_PORT` | `bun run dev` (trong thư mục service) | `GET /api/health` |

Quy ước bắt buộc:

1. **Port hub CHỈ đọc `HUB_INTERNAL_PORT`** (mặc định 3003), port worker CHỈ đọc
   `WORKER_PORT` (mặc định 3005). KHÔNG BAO GIỜ đọc `process.env.PORT` trong
   mini-services — platform deploy export `PORT=3000` cho cả container, đọc nhầm
   là EADDRINUSE chết ngay lúc boot.
2. **Frontend/API gọi dịch vụ khác bằng relative path + `?XTransformPort=<port>`**,
   ví dụ `fetch('/v1/chat/completions?XTransformPort=3003')`. Cấm absolute URL.
3. **Supervisor**: console tự spawn lại hub + worker (probe mỗi 20s, respawn khi
   chết, log marker `[supervisor] spawn bun ...` vào `mini-services/<svc>/dev.log`).
   Nhờ vậy **chỉ cần chạy console là đủ cả 3 dịch vụ**. Tắt bằng
   `HUB_AUTO_SPAWN=0` / `WORKER_AUTO_SPAWN=0` (khi muốn tự quản systemd riêng).
4. **Auth**:
   - `/v1/*` (chat cho client ngoài): `Authorization: Bearer <key>` — key `zhb_*`
     tạo từ tab **API Keys** trên UI (lưu hash SHA-256 tại `.runtime/api-keys.json`).
   - `/internal/*`: header `X-Worker-Secret: <WORKER_SECRET>` — secret khớp giữa
     console và hub. **Không set secret = không gate — CẤM expose công khai.**
   - `/worker` (WS): hub-mint token trong frame đầu (ký bằng `WEBHUB_SECRET` nếu set).
5. **File runtime** nằm ở `.runtime/` của deploy root: `worker-secret.json`,
   `api-keys.json`, `worker-config.json`. Mọi process converge về cùng 1 chỗ qua
   `runtime-paths.ts`. Override env khi cần: `WEBHUB_ROOT`, `WEBHUB_RUNTIME_DIR`,
   `WORKER_SECRET_FILE`, `API_KEYS_FILE`, `WORKER_CONFIG_FILE`.

### Bảng env tham chiếu nhanh

| Env | Đọc bởi | Mặc định | Ý nghĩa |
|---|---|---|---|
| `HUB_INTERNAL_PORT` | hub, supervisor | 3003 | Port hub |
| `WORKER_PORT` | worker, supervisor | 3005 | Port worker HTTP |
| `WORKER_SECRET` | console + hub + worker | — | Gate `/internal/*` + worker đăng ký. Không set = gate tắt |
| `WEBHUB_SECRET` | hub | — | Ký hub-mint token cho WS `/worker` (khuyến nghị set khi public) |
| `TENANT_KEYS` | hub | `zhb_dev_default_key` | Bearer key tĩnh cho `/v1/*` (dev) |
| `HUB_URL` | worker | `ws://localhost:3003/worker` | WS URL hub mà worker connect |
| `HUB_HTTP_BASE` | worker | `http://localhost:3003` | HTTP base cho worker gọi `/internal/worker-token` |
| `WORKER_ID` | worker | `uuid-hostname` | Định danh worker |
| `WORKER_CONCURRENCY` | worker | 2 | Số job chạy song song |
| `WORKER_MODELS` | worker | `glm-5.3` | Danh sách model worker nhận (CSV) |
| `MODE` | worker | `proxy` | `proxy` (qua z-ai-web-dev-sdk local) / `real` (upstream riêng) / `relay` (stub, chưa implement) |
| `UPSTREAM` | worker | `proxy` | Ghi đè upstream khi `MODE=real` |
| `HUB_AUTO_SPAWN` / `WORKER_AUTO_SPAWN` | supervisor | 1 | Đặt `0` để tắt auto-spawn tương ứng |
| `WEBHUB_ROOT` | supervisor + runtime-paths | walk-up | Ghi đè deploy root (chạy từ chỗ lạ) |
| `NEXT_ALLOWED_DEV_ORIGINS` | next.config.ts | — | CSV domain thêm vào `allowedDevOrigins` (chỉ dev mode) |
| `DATABASE_URL` | prisma CLI | `file:db/custom.db` | Chỉ dùng lúc setup/build — runtime console không chạm DB |

---

## A. Chạy trên SANDBOX (platform space-z)

### A1. Dev mode (mặc định — platform đã tự chạy, không cần làm gì)

Platform chạy `.zscripts/dev.sh` lúc boot sandbox: `bun install` → `db:push` →
`next dev :3000` → khởi động từng mini-service bằng `bun run dev`, log tại
`.zscripts/mini-service-<tên>.log`. Console chạy phát triển thêm supervisor
(`--hot`) nên sửa code hub/worker tự reload.

- Mở app: **Preview Panel** của platform (hoặc nút *Open in New Tab*).
- Test stream không cần cấu hình: chọn endpoint **Mock mock-verified** trong khung
  chat (dropdown endpoint) → gửi tin nhắn → metrics TTFB/Thinking/Tổng chạy.
- Kiểm tra hệ dịch vụ: `curl 127.0.0.1:3003/healthz` (hub),
  `curl 127.0.0.1:3005/api/health` (worker).

### A2. Bật gate secret (khuyến nghị ngay sau khi sandbox reboot)

Re-provision sandbox (khoảng 01:00 hằng ngày hoặc khi restart) làm mất `.env.local`,
`.runtime/`, dữ liệu `db/`. Sau reboot:

1. Tạo secret: tab **Workers** trên UI → tạo worker secret (ghi vào
   `.runtime/worker-secret.json`, console + hub tự thấy).
2. Hoặc cách kiểu env: tạo `.env.local` với `WORKER_SECRET=<chuỗi-random>` rồi
   restart console (hub đọc cùng biến).
3. Nếu dùng domain riêng: thêm `NEXT_ALLOWED_DEV_ORIGINS=<domain>` vào `.env.local`.

Kiểm tra lại 3 thứ sau mỗi lần re-provision: **`.env.local`, `.runtime/`, `db/`**.

### A3. Deploy PROD (nút Deploy trên UI platform)

**Trước khi bấm Deploy — checklist:**

1. `bun run lint` sạch.
2. `bunx tsc -p mini-services/hub --noEmit` + `bunx tsc -p mini-services/worker --noEmit` 0 lỗi.
3. Không dùng `next/font/google` hay bất kỳ network call nào lúc BUILD (runner chặn internet).
4. `/api/health`, `/healthz` trả 200 KHÔNG phụ thuộc service ngoài.
5. Đổi code mini-services phải test qua bundle mô phỏng:
   `cd mini-services/hub && bun build index.ts --target bun --minify --outfile /tmp/mini-service-hub.js && bun /tmp/mini-service-hub.js`.

**Pipeline tự chạy khi bấm Deploy** (đọc chi tiết ở `docs/deploy/70`):

```
UI Deploy ──▶ control service (:12600, root)
          ──▶ bash .zscripts/build.sh        (bun install + next build + bundle mini-services
                                              + đóng gói tarball ~12MB tại /tmp/build_fullstack_*.tar.gz)
          ──▶ nạp lên FC instance mới         (cloud API — cần auth context thật của UI)
          ──▶ FC boot: start.sh               (bun server.js :3000 + 2 bundle mini-services + Caddy :81)
          ──▶ health check 120s qua Caddy ──▶ SUCCESS
```

**Sau khi lên sóng (URL `-d.space-z.ai`):**

- Worker hiện **stopped** là *by-design* (prod không có secret) — vào tab
  **Worker node / Workers** để setup lại.
- `.env.local` KHÔNG theo artifact → prod chạy không secret → hãy tạo secret qua
  UI ngay (console ghi `.runtime/` trên prod, hub tự đọc chung chỗ đó).
- **Kiến trúc worker đúng trên prod**: prod FC KHÔNG có config z-ai
  (`/etc/.z-ai-config`) → KHÔNG chạy worker local trên prod nhận job chat.
  Worker node thật phải chạy ở sandbox khác hoặc VPS CÓ z-ai config, tự connect
  về hub prod: `wss://<prod-domain>/worker?XTransformPort=3003`.

**Khi Deploy Failed — chẩn đoán:**

```bash
# Chạy build + upload bằng chatid thật (công cụ chẩn đoán — KHÔNG phải cách deploy thật):
curl -sS -X POST http://127.0.0.1:12600/deploy \
  -H 'Content-Type: application/json' \
  -d '{"userid":"<user-id>","chatid":"<chat-id>"}'
```

| Triệu chứng | Kết luận | Việc cần làm |
|---|---|---|
| Response trả JSON `error`+`logs` | Chết ở BUILD | Đọc log, sửa code — xem checklist trên |
| `Internal Server Error` plain-text SAU khi `/tmp/build_fullstack_*.tar.gz` đã đủ | Đã qua build, chết ở cloud | Deploy phải qua nút UI; retry sau vài phút |
| Domain `-d` trả 500 static mọi path | Chưa từng có FC sống | Deploy lại từ UI |

Mô phỏng FC cục bộ (verify artifact không cần deploy thật):

```bash
rm -rf /tmp/fc-sim && mkdir -p /tmp/fc-sim && tar -xzf /tmp/build_fullstack_*.tar.gz -C /tmp/fc-sim
cd /tmp/fc-sim && NODE_ENV=production PORT=3100 HOSTNAME=0.0.0.0 \
  DATABASE_URL=file:/tmp/fc-sim/db/custom.db bun next-service-dist/server.js
# curl 127.0.0.1:3100/ và /api/health phải 200
```

---

## B. Chạy trên VPS cá nhân

### B1. Yêu cầu

- Linux x64 (Debian/Ubuntu), RAM ≥ 1GB, bun ≥ 1.2 (`curl -fsSL https://bun.sh/install | bash`),
  `git`. **Không cần Node.js** — bun làm tất cả (build, chạy, bundle).
- Domain trỏ A/AAAA về VPS (tuỳ chọn — chỉ cần khi expose public/TLS).
- Tuỳ chọn nhưng khuyến nghị: **Caddy** (gateway giống sandbox + TLS tự động).

### B2. Lấy code + cài đặt

```bash
git clone https://github.com/kungfufanta/ZaiWebHub.git /opt/zaiwebhub
cd /opt/zaiwebhub
bun install
(cd mini-services/hub && bun install)     # BẮT BUỘC — supervisor spawn từ đây
(cd mini-services/worker && bun install)  # BẮT BUỘC
bun run db:push                           # đồng bộ schema SQLite (db/custom.db)
```

### B3. Chạy DEV (1 lệnh duy nhất)

```bash
bun run dev          # next dev :3000 + tee dev.log
```

Supervisor trong console tự spawn hub :3003 + worker :3005 (con của next-server,
`--hot` tự bật trong dev). Mở `http://<ip-vps>:3000` — đủ cả UI, hub, worker.

Chạy thủ công từng service (khi debug — nhớ tắt auto-spawn để khỏi trùng port):

```bash
HUB_AUTO_SPAWN=0 WORKER_AUTO_SPAWN=0 bun run dev &
cd mini-services/hub    && HUB_INTERNAL_PORT=3003 bun run dev &
cd mini-services/worker && WORKER_PORT=3005 bun run dev &
```

### B4. Chạy PROD (build + chạy standalone)

```bash
cd /opt/zaiwebhub
bun run build          # next build + tự copy static/public vào .next/standalone
bun run start          # = NODE_ENV=production bun .next/standalone/server.js
```

- Chạy **từ repo root** (như lệnh trên) để supervisor nhận diện repo layout và
  tự spawn hub/worker (`bun index.ts`, không `--hot` khi `NODE_ENV=production`).
- Env prod nên đặt qua systemd (mục dưới) hoặc export trước khi chạy:
  `WORKER_SECRET`, `WEBHUB_SECRET`, `TENANT_KEYS` (đổi khỏi key dev mặc định!).

**systemd unit** — `/etc/systemd/system/zaiwebhub.service`:

```ini
[Unit]
Description=ZaiWebHub console (Next standalone + supervisor hub/worker)
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/zaiwebhub
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=WORKER_SECRET=<chuỗi-random-dài>
Environment=WEBHUB_SECRET=<chuỗi-random-dài>
Environment=TENANT_KEYS=<key-public-của-bạn>
ExecStart=/home/<user>/.bun/bin/bun .next/standalone/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now zaiwebhub
```

> Nếu muốn tách hub/worker thành unit riêng: đặt `HUB_AUTO_SPAWN=0
> WORKER_AUTO_SPAWN=0` cho unit console, rồi tạo 2 unit `zaiwebhub-hub` /
> `zaiwebhub-worker` chạy `bun index.ts` trong `mini-services/{hub,worker}`
> (env `HUB_INTERNAL_PORT=3003` / `WORKER_PORT=3005`, `WorkingDirectory` =
> thư mục service tương ứng).

### B5. Gateway + domain + TLS

UI fetch dịch vụ khác bằng `?XTransformPort=` — có 2 cách chạy trên VPS:

**Cách 1 — chỉ mở :3000 (đơn giản nhất, worker phải cùng máy):**

Mở firewall mỗi mình 3000 (hoặc đưa Caddy/nginx listen :80/:443 proxy thẳng
`localhost:3000`). Next tự rewrite `/v1/*`, `/api/status`… khi thấy query
`XTransformPort` → hub/worker hoạt động đầy đủ **chừng nào mọi thứ cùng 1 máy**.
Hạn chế: **WebSocket upgrade KHÔNG đi qua được rewrite của Next** → worker node
ở máy khác không connect được; chỉ dùng được worker loopback
(`ws://127.0.0.1:3003/worker`).

**Cách 2 — Caddy gateway giống sandbox (khuyên dùng khi public):**

```bash
# Cài caddy, rồi chỉnh Caddyfile của repo: đổi ":81 {" thành ":80 {"
sudo caddy run --config /opt/zaiwebhub/Caddyfile --adapter caddyfile
```

Domain trỏ về VPS → Caddy tự cấp TLS (ACME) cho HTTPS. Khi đó:
- UI/console: `https://<domain>/`
- Client API: `https://<domain>/v1/chat/completions?XTransformPort=3003` (+ Bearer key)
- Worker node máy khác: `wss://<domain>/worker?XTransformPort=3003` (WS xuyên qua được)
- Chạy caddy bằng systemd (`caddy.service` mặc định của bản cài apt) thay vì foreground.

**Cấm expose trực tiếp 3003/3005 ra internet** — luôn đi qua gateway và giữ
`X-Worker-Secret` gate bật.

### B6. Worker node — 2 kịch bản

Worker tự connect OUTBOUND vào hub (hub không bao giờ inbound vào worker):

| Kịch bản | hub_url cho worker | Ghi chú |
|---|---|---|
| Worker **cùng VPS** với hub | `ws://127.0.0.1:3003/worker` | Đủ, không cần gateway |
| Worker **ở sandbox/VPS khác** | `wss://<domain-hub>/worker?XTransformPort=3003` | Bắt buộc hub phía sau Caddy gateway (Cách 2) |

Cách setup worker: chạy `bun index.ts` trong `mini-services/worker` với env
(`HUB_URL`, `WORKER_ID`, `WORKER_SECRET` khớp hub, `MODE`, …) **hoặc** qua tab
**Worker node** trên UI (ghi `worker-config.json` vào `.runtime/` — cùng cơ chế
với sandbox).

**Điều kiện để worker chạy được job chat:** máy worker phải có cấu hình z-ai
(đọc theo thứ tự `cwd → home → /etc/.z-ai-config`). Sandbox platform có sẵn;
VPS cá nhân cần tự chuẩn bị file config này (hoặc chạy `MODE=real` với
`UPSTREAM` riêng — xem `docs/api.md`).

### B7. Update version

```bash
cd /opt/zaiwebhub
git pull
bun install && (cd mini-services/hub && bun install) && (cd mini-services/worker && bun install)
bun run db:push
bun run build
sudo systemctl restart zaiwebhub        # supervisor tự spawn lại hub/worker
```

### B8. Sự cố thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `EADDRINUSE` lúc boot hub/worker | Port bận (chạy trùng instance, hoặc dịch vụ khác chiếm) | Đổi `HUB_INTERNAL_PORT`/`WORKER_PORT`; nhớ supervisor đang spawn |
| Trang trắng khi mở bằng domain lạ (dev mode) | `allowedDevOrigins` chặn HMR/font | Thêm domain vào `NEXT_ALLOWED_DEV_ORIGINS` (chỉ ảnh hưởng dev; standalone prod không bị) |
| Supervisor không spawn hub/worker | Bị tắt bằng env, sai `WEBHUB_ROOT`, hoặc thiếu `node_modules` của service | Bỏ env toggle; kiểm tra `mini-services/<svc>/dev.log` có marker `[supervisor]` |
| `/internal/*` trả 401 | `WORKER_SECRET` lệch giữa console và hub | Đồng bộ secret (UI tab Workers hoặc env) |
| Chat lỗi, worker dashboard `stopped` | Worker chưa đăng ký / thiếu z-ai config | Setup qua tab Worker node; kiểm tra config z-ai trên máy worker |
| `bun run build` thiếu `.next/standalone/server.js` | Mất `output: "standalone"` trong `next.config.ts` | Trả lại `output: "standalone"` rồi build lại |
| Worker ở máy khác không connect được | Gateway không handle WS (Cách 1) | Chuyển sang Caddy gateway (Cách 2) |

---

## C. Ma trận nhanh "mình nên chạy kiểu nào?"

| Nhu cầu | Đề xuất |
|---|---|
| Dùng thử / demo chat | Sandbox dev mode (A1) — không cần làm gì |
| Console web cho riêng mình, worker cùng máy | VPS Cách 1 (chỉ :3000) + systemd (B4) |
| Console public + worker node phân tán | VPS Cách 2 (Caddy + TLS) + worker connect `wss://` (B5–B6) |
| Deploy theo đúng pipeline platform | Bấm nút Deploy trên UI (A3) — không deploy tay từ trong sandbox |
