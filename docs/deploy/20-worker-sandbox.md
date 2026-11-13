# Runbook WORKER agent (Task ID: 3.5-W1 / 3.5-W2 / 3.6-W)

> Mục tiêu: sandbox của bạn chạy 1 worker (apps/worker :3000) kết nối OUTBOUND tới hub công khai.
> **Workflow mới (3.6-W): deploy sandbox → clone → mở public URL :3000 → paste hub URL + secret → DONE.**
> Worker KHÔNG cần inbound — :3000 của sandbox bạn serve UI setup/status; kết nối tới hub là WS outbound.
> Đọc `docs/deploy/README.md` mục 0 TRƯỚC khi làm (launch pattern + gateway + repo public).

## Input cần có (owner cấp qua chat)

- `<hub-host>` — public URL của sandbox hub (LẤY TỪ TAB WORKERS CỦA HUB DASHBOARD nếu đã có tab đó; hoặc owner cung cấp).
- `<WORKER_SECRET>` — shared secret (KHÔNG commit vào repo, KHÔNG ghi vào file nào ngoài `.worker-config.json` gitignored).
- Worker ID gợi ý: `w1-<tên-sandbox>` / `w2-<tên-sandbox>` (UI pre-fill sẵn `w1-<hostname>` — có thể sửa).

## Bước 1 — Clone + install + launch

```bash
git clone https://github.com/kungfufanta/ZaiWebHub.git && cd ZaiWebHub
bun install
cd apps/worker
( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )
```

- Worker chạy **:3000** (STRICT PORT — nếu :3000 đã bận, log lỗi rõ ràng rồi thoát; KHÔNG tự đổi port).
- Pattern launch bắt buộc: subshell-orphan `( nohup … & )` — CẤM `setsid` / `& disown` trần.
- Verify sống: `ps -o pid,ppid -p <pid>` → ppid=1; `curl http://127.0.0.1:3000/` → 200.

## Bước 2 — Mở public URL :3000 → Setup form

Không có config → worker serve **SETUP FORM**:

```
┌──────────────────────────────────────────────┐
│                  [Z]                         │
│             ZaiWebHub Worker                 │
│  Kết nối sandbox này vào worker-pool hub     │
│ ┌──────────────────────────────────────────┐ │
│ │ Hub URL                                  │ │
│ │ [https://preview-xxx.space-z.ai        ] │ │
│ │ Lấy URL từ tab Workers của hub dashboard.│ │
│ │ Nếu hub sau gateway sandbox, giữ nguyên  │ │
│ │ query (vd ?XTransformPort=3003).         │ │
│ │                                          │ │
│ │ Worker ID                                │ │
│ │ [w1-<hostname-sandbox>  (pre-fill)]      │ │
│ │                                          │ │
│ │ Worker Secret                            │ │
│ │ [••••••••••••  (password, masked)]       │ │
│ │                                          │ │
│ │            [   Connect   ]               │ │
│ │   ⟳ Registering with hub...              │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Điền:
1. **Hub URL** — URL công cộng của hub. Nếu hub chạy sau gateway sandbox (port ≠ mặc định),
   PHẢI kèm query gateway, ví dụ: `https://<hub-host>/?XTransformPort=3003`.
2. **Worker ID** — đã pre-fill `w1-<hostname>`; sửa prefix `w1-`/`w2-` theo vai trò được giao.
3. **Worker Secret** — paste secret owner cấp (masked, không bao giờ hiển thị lại).

Bấm **Connect** → form ghi `.worker-config.json` (gitignored, mode 0600) → runtime WS start →
poll đăng ký → **tự chuyển sang Status dashboard**.

## Bước 3 — Status dashboard (auto-refresh 3s)

```
┌────────────────────────────────────────────────────────────────────┐
│ [Z] ZaiWebHub Worker              [Disconnect / Re-configure]      │
│ Status dashboard — cập nhật tự động mỗi 3 giây                     │
│                                                                    │
│ ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌─────────┐              │
│ │ STATUS   │ │ WORKER ID  │ │ HUB URL   │ │ INFLIGHT│              │
│ │ ● Online │ │ w1-c-…-f06 │ │ https://… │ │ 0 job   │              │
│ └──────────┘ └────────────┘ └───────────┘ └─────────┘              │
│ ┌──────────┐ ┌────────────┐ ┌───────────┐ ┌─────────┐              │
│ │ TOTAL    │ │ UPTIME     │ │ LAST      │ │ UPSTREAM│              │
│ │ JOBS: 1  │ │ 2m 15s     │ │ HEARTBEAT │ │ / MODE  │              │
│ │          │ │ (file)     │ │ 5s trước  │ │ proxy/… │              │
│ └──────────┘ └────────────┘ └───────────┘ └─────────┘              │
│ ┌─ Log tail (100 dòng cuối) ── worker.log ────────────────────────┐ │
│ │ [worker] [info] worker.register sent {…}                        │ │
│ │ [worker] [info] job started {job_id…}                           │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

- **Status**: Online / Registering / Connecting / Reconnecting / Stopped.
- **Disconnect / Re-configure**: stop WS runtime (KHÔNG kill process) + xoá config → về setup form.
- Restart process (kill + launch lại Bước 1) → config file còn → **tự reconnect**, UI khôi phục.

## Bước 4 — Verify nhanh sau khi connect

```bash
curl -s http://127.0.0.1:3000/api/health   # registered:true, connected:true, worker_id đúng
tail -6 worker.log                          # phải có "worker.register sent"
```

Sau đó nhờ owner/H xác nhận hub.log có `worker registered worker_id=<của bạn>`,
và ghi COORDINATION.md theo loop (xem README mục 4).

## ADVANCED — Headless mode qua env (không UI)

Nếu 3 biến env đủ cả 3 (env **ưu tiên hơn** config file khi boot):

```bash
cd apps/worker
export WORKER_SECRET='<WORKER_SECRET>'
export WORKER_ID='w1-<tên-sandbox>'
export HUB_URL='https://<hub-host>/?XTransformPort=3003'   # base hub; wss://…/worker?… cũ vẫn chấp nhận
# (tuỳ chọn) HUB_TOKEN_URL — thiếu sẽ tự derive từ HUB_URL (giữ nguyên query gateway)
( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )
```

`POST /api/setup` khi có env: env vẫn thắng lúc reboot; setup qua UI ghi đè config file như thường.

## API routes

| Route | Method | Ý nghĩa |
|---|---|---|
| `/` | GET | Setup form (chưa config) / Status dashboard (đã config) |
| `/api/setup` | POST | `{hub_url, worker_id, worker_secret}` → ghi config + start runtime (singleton) |
| `/api/status` | GET | configured, phase, registered, connected, inflight, total_jobs, uptime, heartbeat, logs |
| `/api/disconnect` | POST | Stop WS runtime + xoá config file |
| `/api/health` | GET | Giữ nguyên shape cũ (W2/ops script đang dựa vào nó) |

## Troubleshooting

| Hiện tượng | Nguyên nhân / Xử lý |
|---|---|
| `worker-token endpoint HTTP 401` lặp trong log | Sai `WORKER_SECRET` → Disconnect/Re-configure, paste lại secret |
| UI không thấy worker mới ở hub / không nhận job | Sai hub URL (thiếu `?XTransformPort=3003` nếu hub sau gateway) → paste lại đúng URL từ hub dashboard |
| `FATAL: port 3000 ĐÃ BẬN` khi launch | Port bận (dev-console/next cũ chiếm) → `pkill -f 'next dev -p 3000'` rồi launch lại — strict port KHÔNG tự đổi port |
| `WS error: connect ECONNREFUSED/timeout` | Hub chưa lên hoặc sai URL → chạy `curl '<hub>/healthz?XTransformPort=3003'` mong 200 trước |
| `duplicate worker_id` trên hub | 2 process worker cùng ID → `pkill -f 'next dev -p 3000'` rồi start lại 1 instance |
| Worker chết sau vài phút | Sai launch pattern → dùng đúng `( nohup … & )` |

## Lịch sử port (đổi tại 3.6-W)

- **Trước 3.6**: worker `:3004`, cấu hình 100% env, không UI.
- **Từ 3.6**: worker `:3000` (UI setup/status); env headless vẫn được hỗ trợ cho hub sandbox chạy worker nội bộ
  ở port khác (vd `WORKER_PORT=3004 node scripts/dev-strict.mjs` hoặc `dev:direct` + env).
