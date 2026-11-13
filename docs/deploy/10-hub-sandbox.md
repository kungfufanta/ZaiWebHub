# Runbook HUB agent (Task ID: 3.5-H)

> Mục tiêu: 1 sandbox chạy hub (webhub :3003) nhận worker từ các sandbox khác + 1 worker nội bộ.
> Đọc `docs/deploy/README.md` mục 0 (sự thật sandbox) TRƯỚC khi làm.

## Bước 1 — Clone + install

```bash
git clone https://github.com/kungfufanta/ZaiWebHub.git && cd ZaiWebHub
bun install
```

## Bước 2 — Khởi động hub (port 3003)

Secret do owner cấp qua chat (`WORKER_SECRET`). `WEBHUB_SECRET` tự sinh:

```bash
cd apps/webhub
export PORT=3003
export WORKER_SECRET='<WORKER_SECRET-từ-owner>'
export WEBHUB_SECRET="$(openssl rand -hex 24)"
( nohup node node_modules/.bin/tsx watch src/index.ts > hub.log 2>&1 < /dev/null & )
```

CẤM dùng `setsid` hoặc `… & disown` trần — reaper giết process. Đúng mẫu `( nohup … & )`.

## Bước 3 — Verify (MỖI câu 1 invocation riêng)

```bash
tail -5 hub.log                              # "webhub listening" + "worker_secret_required":true
curl -s http://127.0.0.1:3003/healthz        # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}' 'http://localhost:81/healthz?XTransformPort=3003'   # 200
```

## Bước 4 — Worker nội bộ (port 3004, cùng sandbox)

```bash
cd ../worker
export WORKER_SECRET='<cùng giá trị>'
export WORKER_ID='local-w1'
export HUB_URL='ws://localhost:3003/worker'
export HUB_TOKEN_URL='http://localhost:3003/internal/worker-token'
( nohup node node_modules/.bin/next dev -p 3004 > worker-local.log 2>&1 < /dev/null & )
```

Verify (invocation riêng): `curl -s http://127.0.0.1:3004/api/health` → `"registered":true`.
Hub log phải có `worker registered worker_id=local-w1`.

## Bước 5 — Báo cáo public URL

- Lấy **public URL** sandbox của mình (owner xem preview panel / "Open in New Tab"), gửi cho owner.
- Yêu cầu owner (hoặc tự dùng agent-browser nếu có) mở `https://<hub-host>/healthz?XTransformPort=3003` → phải JSON `ok:true`. Đây là bằng chứng path công cộng sống.
- Ghi vào `docs/deploy/COORDINATION.md` dòng HUB (URL + trạng thái), commit `docs(coord): HUB live <url>`, `git pull --rebase && git push`.

## Bước 5b — Sau khi hub live: Hub UI tại :3000 (3.6-H)

Console ở `:3000` là **Hub UI đầy đủ** (nav 3 tab, giữ nguyên chat preview):

| Tab | Nội dung |
|---|---|
| `/` | Console chat preview — 3 mode Mock / Adapter / WebHub (giữ nguyên) |
| `/workers` | Workers management — table từ webhub `GET /internal/workers` (auth `X-Worker-Secret`, poll 5s) + box **Worker Connection Info** sinh URL onboard worker |
| `/stats` | Stats overview — uptime, workers online, total jobs, jobs-per-worker (CSS bar) |

- Console lấy dữ liệu qua server-side proxy `/api/workers` → `HUB_INTERNAL_URL` (mặc định `http://127.0.0.1:3003`) kèm `WORKER_SECRET` từ env — **secret không bao giờ xuống client**.
- Console cần env `WORKER_SECRET` + `HUB_INTERNAL_URL` trong `.env.local` (gitignored, KHÔNG commit).
- `next.config.ts` đã có `allowedDevOrigins` (127.0.0.1 / localhost / *.space-z.ai) — thiếu nó, Next 16 chặn dev resource và hydration stall.

## Bước 6 — Nhận worker remote (Loop 2)

Khi W1/W2 report đã start: kiểm tra hub.log có `worker registered worker_id=w1-…` / `w2-…`.
Registry nhiều worker → dispatch **least-loaded** tự động, không cần config thêm.

## Bước 7 — Failure drill (Loop 4)

- Kill 1 worker giữa stream (`pkill -f 'next dev -p 3004'` trên sandbox W đó) → client phải nhận
  `event:error` + `[DONE]` sạch (đang stream) hoặc re-dispatch sang worker còn lại (trước chunk đầu).
- Restart worker → registry cập nhật, dispatch trở lại bình thường.

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Xử lý |
|---|---|---|
| `worker-token endpoint HTTP 401` ở log worker | W sai/thiếu `WORKER_SECRET` | Đối chiếu env 2 bên |
| 502 từ gateway | Service chưa lên / sai port trong XTransformPort | `ss -tlnp` kiểm tra port |
| Hub chết sau vài phút | Launch sai pattern (setsid/`& disown`) | Dùng `( nohup … & )` |
| 2 hub cùng lúc | Instance cũ còn sống | `pkill -f 'tsx watch src/index.ts'` rồi launch lại |
