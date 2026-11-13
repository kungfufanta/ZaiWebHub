# Đợt 3.5 — Multi-Sandbox Deployment Guide

> Mục tiêu: **hub dùng được thật** — hub ở 1 sandbox, worker ở các sandbox khác kết nối qua
> internet công cộng, owner mở browser dùng UI. Toàn bộ quy tắc vận hành sandbox nằm ở đây.

## 0. SỰ THẬT SANDBOX ĐÃ KIỂM CHỨNG (bắt buộc đọc)

| Sự thật | Chi tiết |
|---|---|
| **Launch pattern** | `( nohup CMD > log.log 2>&1 < /dev/null & )` — subshell-orphan. Process phải trở thành orphan (ppid=1) và KHÔNG phải session leader ngay TRONG invocation → sống qua ranh giới invocation. |
| **CẤM** | `setsid nohup … & disown` — reaper của harness giết session leader sau mỗi invocation. `CMD &` trần cũng chết. |
| **Loopback cross-invocation** | OK — process đã orphan-launch thì curl từ invocation sau vẫn tới được `127.0.0.1:<port>`. |
| **Gateway công cộng** | Caddy ngoài (`:81` trong sandbox) forward mọi request có `?XTransformPort=<port>` — **bao gồm WebSocket upgrade** — tới `localhost:<port>`. Đã verify HTTP 200 tới hub `:3003`. |
| **URL công cộng** | Mỗi sandbox có 1 public URL (owner lấy từ preview panel / nút "Open in New Tab"). Mọi path công cộng đi qua gateway này. |
| **`/etc/.z-ai-config`** | Có sẵn trong MỌI sandbox Z.AI → adapter `UPSTREAM=proxy` chạy được ngay, không cần key. |
| **Repo** | `https://github.com/kungfufanta/ZaiWebHub` — **public**, clone không cần PAT. |

## 1. Topology

```
Owner browser ──▶ https://<hub-host>/                    dev-console :3000 (UI 3 mode)
                    │  WebHub mode: /v1/chat/completions?XTransformPort=3003 (relative, qua gateway)
                    ▼
              Caddy gateway (public) ──▶ webhub :3003   (HUB — registry+dispatch+relay, BYTE-BLIND)
                    ▲  wss://<hub-host>/worker?XTransformPort=3003   (outbound từ worker)
       ┌────────────┼──────────────┐
  worker sandbox W1   worker sandbox W2   (mỗi sandbox 1 worker, ID riêng, secret chung)
```

- **HUB sandbox** (hiện tại: sandbox của coordinator — đang LIVE): hub `:3003` + console `:3000` + 1 worker nội bộ `:3004`.
- **WORKER sandboxes** (W1, W2): chỉ chạy `apps/worker` `:3004`, outbound tới hub, KHÔNG cần inbound.
- Auth: worker fetch token từ hub kèm header `X-Worker-Secret` = `WORKER_SECRET` (owner cấp qua chat, KHÔNG commit).

## 2. Ports

| Port | Service | Ghi chú |
|---|---|---|
| 3000 | dev-console (Next.js) | UI public — mở root public URL là thấy |
| 3003 | webhub hub (Hono) | public qua `?XTransformPort=3003` |
| 3004 | worker (Next.js dev) | KHÔNG cần public; `/api/health` xem nội bộ |

## 3. Vai trò & runbooks

| Role | File | Task ID |
|---|---|---|
| HUB agent | [10-hub-sandbox.md](./10-hub-sandbox.md) | 3.5-H |
| WORKER agent | [20-worker-sandbox.md](./20-worker-sandbox.md) | 3.5-W1 / 3.5-W2 |
| CONSOLE agent | [30-console-sandbox.md](./30-console-sandbox.md) | 3.5-C |

## 4. Vòng test liên tục (test với nhau qua repo)

Mỗi loop xong → ghi 1 dòng vào [COORDINATION.md](./COORDINATION.md) → commit `docs(coord): <role> loop<N> <PASS/FAIL>` → `git pull --rebase` rồi `git push`.

- **Loop 1 — Reachability** (W): từ sandbox worker, `curl 'https://<hub-host>/healthz?XTransformPort=3003'` → phải 200.
- **Loop 2 — Register** (W+H): worker start → log worker có `worker.register sent`; H xác nhận hub.log có `worker registered` với worker_id của W.
- **Loop 3 — E2E chat** (C hoặc owner): console WebHub mode (hoặc curl) → SSE nguyên bản upstream, đúng 1 `[DONE]`, job_id hiển thị; dispatch PHÂN BỔ giữa W1/W2 (least-loaded — hub log `job.dispatch sent (direct push)` khác nhau mỗi request).
- **Loop 4 — Failure drill** (H+W): kill worker giữa stream → user nhận `event:error` + `[DONE]` sạch; chết TRƯỚC chunk đầu → re-dispatch worker còn lại (max 1).
- **Loop 5 — Load nhẹ** (C): 5 request đồng thời → không crash, TTFB ghi lại.

Nhãn xác minh bắt buộc (PLANS.md #7): mọi kết quả là `mock-verified` / `no-reasoning (proxy)` — reasoning thật chờ key production (`real-upstream-verified`).

## 5. Bảo mật

- `WORKER_SECRET` + key tenant: truyền qua chat owner↔agent, chỉ đặt vào env khi chạy. **KHÔNG commit, KHÔNG ghi vào file trong repo, KHÔNG log giá trị.**
- Hub không set `WORKER_SECRET` → chỉ dùng loopback, CẤM expose công khai.
