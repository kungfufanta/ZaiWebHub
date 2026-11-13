# apps/dev-console — PLAN (Task T1-c, T4-a)

Next.js App Router (port 3000 trong sandbox — app duy nhất browser chạm tới).
Chat UI CÓ BỘ NHỚ hội thoại, dùng để kiểm chứng dòng stream prompt → thinking → answer KHÔNG ĐỨT.

## Nguồn tham khảo (prototype sandbox my-project — ĐÃ CHẠY ĐƯỢC, copy chứ không viết lại)
- UI chat đầy đủ: `src/components/chat/*` (thinking-panel collapsible, event-log, stream-stats-bar, composer, message-list, session-sidebar)
- Bộ nhớ hội thoại: `src/hooks/use-chat-sessions.ts`
- SSE client parser: `src/lib/sse-client.ts`
- Types + metrics kiểm chứng không đứt (`ttfbMs, sawFinish, sawDone, eventCount`): `src/lib/chat-types.ts`
→ T1-c chủ yếu là copy + đổi endpoint + đổi types sang `@zaiwebhub/protocol`.

## T1-c — Harness chạy adapter TRỰC TIẾP (chưa qua hub)
- Route `POST /api/adapter-chat`: nhận `{ messages, ... }` → gọi `streamChat()` của `@zaiwebhub/zai-adapter` → emit SSE đúng contract.
- UI: sidebar danh sách hội thoại (localStorage), khung chat, nút Stop (AbortController).
- Mục đích: khóa chắc tầng lib TRƯỚC khi thêm worker/hub. Mọi lỗi streaming ở đây = lỗi adapter, không phải hạ tầng.
- Bộ nhớ hội thoại: localStorage (list conversation + messages). KHÔNG phụ thuộc hub.

## T4-a — E2E QUA WEBHUB THẬT
- Đổi endpoint sang `POST /v1/chat/completions?XTransformPort=3003` (webhub thật) — vẫn relative URL, CẤM ghi port trực tiếp.
- Panel debug hiển thị: `job_id`, `worker_id` (nếu hub trả), TTFB, đếm chunk thinking/answer, tổng thời gian, `event:error` nếu có.
- Nút "Stress test": gửi prompt ý tưởng dài (>= 300 từ) buộc thinking dài, xác nhận không đứt.
- Bộ nhớ hội thoại chuyển lên hub qua `conversation_id` (T3-d) — localStorage chỉ còn cache hiển thị.

## Checklist nghiệm thu chung (copy vào PR khi T4-a xong)
- [ ] `thinking_start → thinking_delta* → answer_start → answer_delta* → finish → [DONE]` đầy đủ, đúng thứ tự
- [ ] TTFB < 5s với glm-5.3, thinking enabled
- [ ] Prompt ý tưởng dài: không đứt, không lặp, không mất delta
- [ ] Stop giữa chừng: user ngừng nhận, `job.cancel` hoạt động (không worker treo)
- [ ] Lỗi (sai key/model) → `event:error` trong stream + `[DONE]`, UI hiển thị rõ
- [ ] Mobile + desktop layout ổn (responsive), footer sticky đúng chuẩn

## Quy tắc gateway sandbox (BẮT BUỘC)
- Mọi fetch từ browser: relative URL + `?XTransformPort=...` khi tới mini-service khác port.
- CẤM ghi port/địa chỉ tuyệt đối trong URL (kể cả WebSocket từ browser).

## Nhật ký thực thi (agent ghi vào đây)
- [T1-c-mock] Đã dựng apps/dev-console hoàn chỉnh ở chế độ MOCK (chưa ghép adapter/hub): UI chat + bộ nhớ phiên copy từ prototype my-project; thêm route `POST /api/mock-chat` phát SSE đúng bảng contract của packages/protocol (`thinking_start → thinking_delta* → answer_start → answer chunks OpenAI-format → finish → [DONE]`), nhánh `error_test` và abort/stop qua AbortController; endpoint client mặc định `/api/mock-chat`, ghi đè được bằng `NEXT_PUBLIC_CHAT_ENDPOINT` (chuẩn bị sẵn cho T4-a). Chi tiết đầy đủ: `agent-ctx/T1-c-mock-coder.md`.
