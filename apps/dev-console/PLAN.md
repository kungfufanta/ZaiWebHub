# apps/dev-console — PLAN (Task T1-c, T4-a)

Next.js App Router. Chat UI CÓ BỘ NHỚ hội thoại, dùng để kiểm chứng dòng stream prompt → thinking → answer KHÔNG ĐỨT.

> **Port sandbox (Đợt 2-final):** dev-console chạy **port 3005** (`next dev -p 3005`) — port 3000 đang là my-project prototype (mặt hiển thị user trong preview panel). Khi hạ tầng chạy ổn, owner-session agent sẽ switch port 3000 sang dev-console. Browser chạm dev-console qua agent-browser local; user thấy harness E2E qua prototype trên :3000 (đã có toggle "Via WebHub").

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
> **Nhãn bắt buộc (Đợt 2-final):** mỗi dòng checklist khi hoàn thành phải ghi `mock-verified` hay `real-upstream-verified`. Sandbox chỉ đạt được `mock-verified` cho thinking; `real-upstream-verified` chỉ đạt được trên VPS với `UPSTREAM=real` + key thật.
- [ ] Wire = upstream nguyên bản: `data: {chunk OpenAI}` có `delta.reasoning_content` (nếu có) → `delta.content` → chunk cuối `finish_reason` + `usage` → `data: [DONE]` — đủ, đúng thứ tự (custom events thinking_*/answer_* đã DEPRECATED)
- [ ] Thinking panel TỰ ĐỘNG hiện khi có `delta.reasoning_content`, ẩn/placeholder khi không có (F7 — không config) — `mock-verified` (sandbox không có reasoning thật)
- [ ] TTFB < 5s với thinking enabled — `mock-verified` (sandbox: glm-4-plus qua proxy); `real-upstream-verified` chờ VPS
- [ ] Prompt ý tưởng dài: không đứt, không lặp, không mất delta
- [ ] Stop giữa chừng: user ngừng nhận, `job.cancel` hoạt động (không worker treo)
- [ ] Lỗi (sai key/model) → `event:error` trong stream + `[DONE]`, UI hiển thị rõ
- [ ] Mobile + desktop layout ổn (responsive), footer sticky đúng chuẩn

## Quy tắc gateway sandbox (BẮT BUỘC)
- Mọi fetch từ browser: relative URL + `?XTransformPort=...` khi tới mini-service khác port.
- CẤM ghi port/địa chỉ tuyệt đối trong URL (kể cả WebSocket từ browser).

## Nhật ký thực thi (agent ghi vào đây)
- [T1-c-mock] (**mock-verified**) Đã dựng apps/dev-console hoàn chỉnh ở chế độ MOCK (chưa ghép adapter/hub): UI chat + bộ nhớ phiên copy từ prototype my-project; thêm route `POST /api/mock-chat` phát SSE đúng bảng contract của packages/protocol (`thinking_start → thinking_delta* → answer_start → answer chunks OpenAI-format → finish → [DONE]`), nhánh `error_test` và abort/stop qua AbortController; endpoint client mặc định `/api/mock-chat`, ghi đè được bằng `NEXT_PUBLIC_CHAT_ENDPOINT` (chuẩn bị sẵn cho T4-a). Chi tiết đầy đủ: `agent-ctx/T1-c-mock-coder.md`. **Lưu ý Đợt 2-final: mock này phát wire contract CŨ (custom events) — khi ghép adapter/webhub thật, wire là upstream nguyên bản; UI parse `delta.reasoning_content` trực tiếp; panel thinking tự động theo F7. Chỉnh route mock cho phát wire mới (upstream-native) trước khi dán nhãn mock-verified lại.**
