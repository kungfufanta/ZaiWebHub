# COORDINATION — Đợt 3.5 Multi-Sandbox

> File chia sẻ chung của các agent. Mỗi agent SỬA ĐÚNG dòng của mình ở bảng status + APPEND nhật ký.
> Luật commit: `docs(coord): <role> <loop/nội dung> <PASS/FAIL>`; `git pull --rebase` TRƯỚC khi push.
> KHÔNG commit secret/key vào file này hay bất kỳ file nào trong repo.

## 1. Bảng trạng thái (mỗi agent 1 dòng)

| Role | Task ID | Sandbox host | Vai trò/Port | Trạng thái | Cập nhật (UTC) |
|---|---|---|---|---|---|
| HUB (coordinator) | 3.5-H | *(sandbox hiện tại — URL do owner nắm)* | hub :3003 + console :3000 + worker nội bộ local-w1 :3004 | **LIVE** — register OK, gateway 200, E2E SSE PASS (5 chunk / 1 [DONE] / finish stop) | 2026-11-13 |
| W1 | 3.5-W1 | c-6af6b891-140d72b5-f60f886f06dc | worker :3004 → hub | **REGISTERED** (w1-c-6af6b891-140d72b5-f60f886f06dc) — connected:true, inflight 0; chờ H xác nhận hub.log | 2026-11-13 |
| W2 | 3.5-W2 | c-6af6b9ae-140d72b5-5aff54cafef5 | worker :3004 → hub (w2-c-6af6b9ae-140d72b5-5aff54cafef5) | **LIVE** — loop1-3 PASS; loop4 partial (finding về remote kill-mid-stream); loop5 PASS | 2026-11-13T08:06Z |
| C | 3.5-C | (trên hub sandbox) | console :3000 | **LIVE** (phương án A) | 2026-11-13 |

## 2. Nhật ký test (append-only, mới nhất TRÊN CÙNG)

Định dạng: `- [UTC time] [role] [loop] [PASS/FAIL] — chi tiết ngắn (số liệu, job_id, nguyên nhân nếu FAIL).`

- [2026-11-13T08:12Z] [W1] [loop2] PASS — worker :3004 start đúng Bước 3 (subshell-orphan, Ready 1785ms). `/api/health`: registered:true, connected:true, worker_id `w1-c-6af6b891-140d72b5-f60f886f06dc`, upstream proxy, attempt 0. worker.log có `worker.register sent` (concurrency 2, models glm-5.3, protocol v1), KHÔNG có 401. Cần H xác nhận hub.log `worker registered`.
- [2026-11-13T08:06Z] [W2] [loop5] PASS — 5 request đồng thời qua gateway hub: 5/5 HTTP 200, mỗi stream đúng 1 `[DONE]` + `finish_reason:stop`, KHÔNG crash (w2 alive, `registered:true, inflight:0, attempt:0` sau load). TTFB từng req: 1219/989/1005/890/925ms — **trung bình ~1005ms**; total 2.7-3.8s. Phân bổ: w2 nhận 1/5 (job `109a41d9`, done sạch 27 chunks + usage), 4/5 w1-side. Ghi chú bc không có trong sandbox — TTFB tính tay.
- [2026-11-13T08:05Z] [W1] [loop1] PASS — curl `https://<hub-host>/healthz?XTransformPort=3003` từ sandbox W1 (host `c-6af6b891-140d72b5-f60f886f06dc`) → HTTP 200. Repo clone @ cd3135b, bun install 1152 packages OK. Sang Bước 3 (start worker :3004).
- [2026-11-13T08:04Z] [W2] [loop4] PARTIAL — kill-w2-mid-stream drill (3 lần chạy, pkill đúng runbook, chỉ giết worker của W2): (a) **kill TRƯỚC chunk đầu → re-dispatch PASS**: client nhận stream đầy đủ qua worker còn sống sau queue-drain (req5: ttfb 14.3s, total 25.6s, 1 `[DONE]`, finish stop — max 1 re-dispatch đúng spec); (b) **route job mới sang w1 khi w2 chết PASS**: khi w2 dead, toàn bộ request mới + queue drain đi w1-side, 7/7 client stream đầy đủ sạch (drill 4e); (c) **kill GIỮA stream (sau chunk đầu) → FINDING: FAIL client-side** — 2/2 lần đo (4d: 3.5KB rồi treo, đứt ~50.9s; 4f: 28KB rồi treo, đứt ~53.7s) client KHÔNG nhận `event:error` hay `data: [DONE]`, stream treo ~50s rồi bị cắt giữa chunk. W2 log xác nhận chunk đang chảy (`job executing`) lúc kill. Giả thuyết nguyên nhân (cần H xác nhận qua hub.log): hub không nhận WS close của remote worker kịp (double gateway không propagate FIN) → job kẹt `streaming`; sweep heartbeat 45s có thể gỡ + settle nhưng frame lỗi không tới client (socket đã bị idle-timeout cắt ~50s, hoặc settle không flush). Đề nghị H kiểm tra hub.log: `worker removed from registry` cho w2 xuất hiện lúc nào so với mốc kill 07:54:50/08:03:19; kiểm tra idle/read timeout của gateway. KHÔNG sửa code lõi (quy tắc W2). (d) Restart lại đúng Bước 3 sau kill: `worker.register sent` + `registered:true` OK (làm 2 lần).
- [2026-11-13T07:49Z] [W2] [loop3] PASS — 3 đợt đo từ sandbox W2 (curl qua gateway hub, dev key): (1) tuần tự 6 req → w2 nhận 0/6 (đúng cơ chế tie-break registry-order khi cả pool đều rảnh); (2) chồng lấn 6 req → w2 nhận 1/6; (3) burst đồng thời 6 req → **w2 nhận 2/6** (2 job `ab08962a`, `e5212c4b`, cả 2 start ở `inflight:2` = đúng cap concurrency=2), 4/6 sang w1-side. Mọi request 200 + đúng 1 `[DONE]` + finish stop. Least-loaded phân bổ job cho CẢ w1 và w2 xác nhận (tỉ lệ burst: w1-side 4/6 — 67%, w2 2/6 — 33%). TTFB burst trung bình ~967ms. Job trên w2 chạy trọn vòng đời: `job started` → `job executing` → `job ended: done` (43 chunks, usage OK, `scan_done:true`, `upstream_done_relayed_sent:true`). Ghi chú: hub có thể thấy >2 worker (local-w1 + w1-remote + w2) — đề nghị H/owner xác nhận danh sách worker trong hub.log.
- [2026-11-13T07:44Z] [W2] [loop2] PASS — worker `w2-c-6af6b9ae-140d72b5-5aff54cafef5` :3004 register OK qua gateway công cộng: WS connected, fetch token OK (không 401), log có `worker.register sent`, /api/health → `registered:true, connected:true, inflight:0, attempt:0`. Xác nhận chức năng hub thấy w1+w2 có thêm ở loop3 (job dispatch sang cả 2 phía).
- [2026-11-13T07:44Z] [W2] [loop1] PASS — curl `https://<hub-host>/healthz?XTransformPort=3003` từ sandbox W2 → HTTP 200.
- [2026-11-13T07:16Z] [HUB] [boot+e2e] PASS — hub :3003 (WORKER_SECRET gate ON) + worker local-w1 :3004; E2E SSE 5 data / 1 [DONE] / finish_reason stop / TTFB 409ms / `upstream_done_relayed:true`; gateway `:81 + XTransformPort=3003` → HTTP 200. Launch pattern `( nohup … & )` sống qua ranh giới invocation (6+ lần verify).
- [2026-11-13T07:21Z] [C] [boot] PASS — console :3000 trên hub sandbox; proxy test qua rewrite :3000 → hub → SSE raw upstream + usage + 1 [DONE].

## 3. Checklist tổng (tick khi xong)

- [x] Loop 1 — W1 curl gateway hub từ sandbox W1 → 200
- [x] Loop 1 — W2 — PASS (HTTP 200, 2026-11-13T07:44Z)
- [x] Loop 2 — W1 register (hub log xác nhận)
- [x] Loop 2 — W2 register — worker-side PASS (chờ hub log xác nhận)
- [x] Loop 3 — E2E dispatch phân bổ W1/W2 (least-loaded) — burst 6 req: w2 2/6, w1-side 4/6, mọi stream 1 [DONE] (2026-11-13T07:49Z)
- [x] Loop 4 — kill worker giữa stream: W2 drill PARTIAL — re-dispatch trước-chunk PASS, route-new-job PASS, kill-giữa-stream remote FAIL client-side (không nhận event:error/[DONE], cần H soi hub.log) (2026-11-13T08:04Z)
- [x] Loop 5 — 5 request đồng thời: 5/5 sạch 1 [DONE], không crash, TTFB trung bình ~1005ms (2026-11-13T08:06Z)
- [ ] Owner dùng UI thành công (bằng chứng screenshot/mô tả)
