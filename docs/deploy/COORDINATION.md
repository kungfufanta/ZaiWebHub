# COORDINATION — Đợt 3.5 Multi-Sandbox

> File chia sẻ chung của các agent. Mỗi agent SỬA ĐÚNG dòng của mình ở bảng status + APPEND nhật ký.
> Luật commit: `docs(coord): <role> <loop/nội dung> <PASS/FAIL>`; `git pull --rebase` TRƯỚC khi push.
> KHÔNG commit secret/key vào file này hay bất kỳ file nào trong repo.

## 1. Bảng trạng thái (mỗi agent 1 dòng)

| Role | Task ID | Sandbox host | Vai trò/Port | Trạng thái | Cập nhật (UTC) |
|---|---|---|---|---|---|
| HUB (coordinator) | 3.5-H | *(sandbox hiện tại — URL do owner nắm)* | hub :3003 + console :3000 + worker nội bộ local-w1 :3004 | **LIVE** — register OK, gateway 200, E2E SSE PASS (5 chunk / 1 [DONE] / finish stop) | 2026-11-13 |
| W1 | 3.5-W1 / 3.6-W | c-6af6b891-140d72b5-f60f886f06dc | worker UI :3000 (3.6-W) → hub | **3.6-W DONE** — UI setup/status, verify a–h PASS, dispatch tới W1 xác nhận | 2026-11-13 |
| W2 | 3.5-W2 | *(chờ agent)* | worker :3004 → hub | todo | — |
| C | 3.5-C | (trên hub sandbox) | console :3000 | **LIVE** (phương án A) | 2026-11-13 |

## 2. Nhật ký test (append-only, mới nhất TRÊN CÙNG)

Định dạng: `- [UTC time] [role] [loop] [PASS/FAIL] — chi tiết ngắn (số liệu, job_id, nguyên nhân nếu FAIL).`

- [2026-11-13T08:42Z] [W1] [3.6-W] PASS — worker chuyển :3004→:3000 + UI setup/status hoàn tất. Verify a–h: (a) no-config → setup form; (b) paste URL+secret → registered online; (c+d) 3 chat đồng thời qua gateway hub → 2 dồn local-w1, job `124c7c60` dispatch về W1 (`job started`, TTFB 450ms, 3 events, đúng 1 [DONE], finish stop); (e) dashboard total_jobs 0→1 (poll 3s); (f) disconnect → config xoá → setup form; (g) reconnect OK; (h) restart process → config bền, WS tự reconnect. Strict port :3000 (bận → FATAL rõ ràng, không tự đổi). /api/health giữ nguyên shape. NOTE: console hub sandbox chưa có tab Workers + chưa hydrate qua automation (flight=0) — đã verify bằng đúng HTTP request WebHub mode của console (Bearer zhb_dev_default_key, same-origin).
- [2026-11-13T08:12Z] [W1] [loop2] PASS — worker :3004 start đúng Bước 3 (subshell-orphan, Ready 1785ms). `/api/health`: registered:true, connected:true, worker_id `w1-c-6af6b891-140d72b5-f60f886f06dc`, upstream proxy, attempt 0. worker.log có `worker.register sent` (concurrency 2, models glm-5.3, protocol v1), KHÔNG có 401. Cần H xác nhận hub.log `worker registered`.
- [2026-11-13T08:05Z] [W1] [loop1] PASS — curl `https://<hub-host>/healthz?XTransformPort=3003` từ sandbox W1 (host `c-6af6b891-140d72b5-f60f886f06dc`) → HTTP 200. Repo clone @ cd3135b, bun install 1152 packages OK. Sang Bước 3 (start worker :3004).
- [2026-11-13T07:16Z] [HUB] [boot+e2e] PASS — hub :3003 (WORKER_SECRET gate ON) + worker local-w1 :3004; E2E SSE 5 data / 1 [DONE] / finish_reason stop / TTFB 409ms / `upstream_done_relayed:true`; gateway `:81 + XTransformPort=3003` → HTTP 200. Launch pattern `( nohup … & )` sống qua ranh giới invocation (6+ lần verify).
- [2026-11-13T07:21Z] [C] [boot] PASS — console :3000 trên hub sandbox; proxy test qua rewrite :3000 → hub → SSE raw upstream + usage + 1 [DONE].

## 3. Checklist tổng (tick khi xong)

- [x] Loop 1 — W1 curl gateway hub từ sandbox W1 → 200
- [ ] Loop 1 — W2 tương tự
- [x] Loop 2 — W1 register (hub log xác nhận)
- [ ] Loop 2 — W2 register
- [ ] Loop 3 — E2E chat qua console, dispatch phân bổ W1/W2 (least-loaded)
- [ ] Loop 4 — kill worker giữa stream → error+[DONE] sạch / re-dispatch OK
- [ ] Loop 5 — 5 request đồng thời → không crash, ghi TTFB
- [ ] Owner dùng UI thành công (bằng chứng screenshot/mô tả)
