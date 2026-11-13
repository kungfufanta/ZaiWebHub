# Runbook WORKER agent (Task ID: 3.5-W1 / 3.5-W2)

> Mục tiêu: sandbox của bạn chạy 1 worker (apps/worker :3004) kết nối OUTBOUND tới hub công khai.
> Worker KHÔNG cần inbound — public :3000 của sandbox bạn KHÔNG dùng cho worker.
> Đọc `docs/deploy/README.md` mục 0 TRƯỚC khi làm.

## Input cần có (owner cấp qua chat)

- `<hub-host>` — public URL của sandbox hub.
- `<WORKER_SECRET>` — shared secret (KHÔNG commit vào repo).
- Worker ID của bạn: `w1-<tên-sandbox>` hoặc `w2-<tên-sandbox>`.

## Bước 1 — Clone + install

```bash
git clone https://github.com/kungfufanta/ZaiWebHub.git && cd ZaiWebHub
bun install
```

## Bước 2 — Loop 1: kiểm tra thấy được hub TỪ sandbox của bạn (TRƯỚC khi start worker)

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'https://<hub-host>/healthz?XTransformPort=3003'   # mong 200
```

Nếu không phải 200 → báo owner NGAY (ghi COORDINATION.md, commit `docs(coord): W1 loop1 FAIL`), không đi tiếp.

## Bước 3 — Khởi động worker (port 3004)

```bash
cd apps/worker
export WORKER_SECRET='<WORKER_SECRET>'
export WORKER_ID='w1-<tên-sandbox>'
export HUB_URL='wss://<hub-host>/worker?XTransformPort=3003'
export HUB_TOKEN_URL='https://<hub-host>/internal/worker-token?XTransformPort=3003'
# UPSTREAM mặc định = proxy (zsdk đọc /etc/.z-ai-config có sẵn trong sandbox) — không cần set.
( nohup node node_modules/.bin/next dev -p 3004 > worker.log 2>&1 < /dev/null & )
```

CẤM `setsid` / `& disown` trần — dùng đúng `( nohup … & )`.

## Bước 4 — Verify (mỗi câu 1 invocation riêng)

```bash
curl -s http://127.0.0.1:3004/api/health     # "registered":true, "connected":true, worker_id đúng
tail -6 worker.log                            # phải có "worker.register sent"
```

Log worker có `worker-token endpoint HTTP 401` lặp → sai/thiếu secret → đối chiếu lại env với owner.

## Bước 5 — Báo cáo (Loop 2)

- Ghi `docs/deploy/COORDINATION.md` dòng W1/W2 (worker_id, sandbox, trạng thái), commit
  `docs(coord): W1 loop2 registered`, `git pull --rebase && git push`.
- Nhờ H xác nhận hub.log thấy `worker registered worker_id=<của bạn>`.

## Bước 6 — Nhận job thật (Loop 3)

Nhờ C/owner bắn 1 chat qua console (WebHub mode). Nếu job dispatch tới worker bạn:
log có `job started` → `job done`. Đóng góp số liệu: TTFB, số chunk, finish_reason.

## Bước 7 — Phục vụ Loop 4 (failure drill)

Khi H yêu cầu: `pkill -f 'next dev -p 3004'` (giả chết giữa stream), rồi start lại đúng Bước 3.

## Lỗi thường gặp

| Hiện tượng | Xử lý |
|---|---|
| `WS error: connect ECONNREFUSED/timeout` tới hub | Loop 1 chưa PASS — báo owner, kiểm tra URL `wss://` + query `?XTransformPort=3003` |
| `worker-token endpoint HTTP 401` | Sai `WORKER_SECRET` hoặc thiếu header (worker cũ < Đợt 3.5) — pull repo mới nhất |
| Worker chết sau vài phút | Sai launch pattern — dùng `( nohup … & )` |
| `duplicate worker_id` trên hub | 2 process worker cùng ID — `pkill -f 'next dev -p 3004'` rồi start lại 1 instance |
