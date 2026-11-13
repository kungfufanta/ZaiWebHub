# apps/

| Thư mục | Vai trò | Plan chi tiết |
|---|---|---|
| `webhub/` | WS hub + dispatcher + StateStore + `POST /v1/chat/completions` (SSE). Service duy nhất user chạm tới. | `apps/webhub/PLAN.md` |
| `worker/` | Chạy trong sandbox Z.AI: WS outbound → hub, nhận job, gọi zai-adapter, stream về. `MODE=relay` = proxy fallback (không có thư mục proxy riêng — cùng codebase). | `apps/worker/PLAN.md` |
| `dev-console/` | Next.js chat UI có bộ nhớ hội thoại — harness adapter (T1-c) + E2E qua hub (T4-a). | `apps/dev-console/PLAN.md` |

Quy tắc chung:
- Đọc `PLANS.md` (gốc repo) TRƯỚC khi làm bất cứ task nào. Task ID được cấp từ Task Board ở PLANS.md section 6.
- `packages/protocol/PLAN.md` là hợp đồng chung — không tự chế tên event/frame.
- Commit theo cú pháp `feat(T2-a): ...`; xong task thì cập nhật trạng thái trong PLANS.md + ghi "Nhật ký thực thi" trong PLAN.md của app.
