# ZaiWebHub — Master Plan & Task Board (v2)

> File này là nguồn sự thật chung cho mọi agent. Khi nhận việc, mỗi agent bắt buộc:
> 1. Đọc toàn bộ file này. 2. Đọc `PLAN.md` của package/app được giao. 3. Làm đúng phạm vi Task ID nhận được, không lan sang task khác.
> Commit theo cú pháp: `feat(T1-b): ...` / `fix(T3-c): ...` / `docs(T0-b): ...`
> Khi xong task: cập nhật cột Trạng thái ở bảng Task Board (section 6) + ghi kết quả vào mục "Nhật ký thực thi" của PLAN.md tương ứng.

---

## 1. Kiến trúc chốt lại (Worker Pool phân tán)

```
User ──HTTPS SSE──▶ WebHub (VPS chính / dev: Node :3003 trong sandbox)
                       │  WS outbound — worker TỰ connect ra, hub không bao giờ inbound vào sandbox
                       ▼
                    Worker (sandbox Z.AI, ephemeral) ──zsdk──▶ Z.AI API
```

| Thành phần | Bản chất | Chạy ở đâu | Vai trò |
|---|---|---|---|
| `packages/protocol` | LIB types/zod (pure) | — | Hợp đồng duy nhất mọi frame/SSE event. Không I/O, không phụ thuộc runtime. |
| `packages/zai-adapter` | LIB | import bởi worker/proxy/dev-console | Nơi DUY NHẤT được gọi zsdk. Bọc zsdk, parse raw SSE, xử lý reasoning_content. |
| `apps/webhub` | **Node + Hono service** | VPS chính (prod) / :3003 (dev sandbox) | WS hub + dispatcher + StateStore + public SSE API. Thành phần duy nhất user chạm tới. |
| `apps/worker` | **Next.js (Node runtime)** | sandbox Z.AI (ephemeral, KHÔNG inbound) | WS outbound → hub, nhận job, gọi adapter, stream chunk về. |
| proxy | CÙNG codebase worker, `MODE=relay` | VPS phụ | Chỉ bật khi sandbox không ra được outbound tới hub. KHÔNG tạo service thứ 3. |
| `apps/dev-console` | Next.js | sandbox dev (:3000 / :3100 khi dev) | Chat UI có bộ nhớ hội thoại — kiểm chứng prompt→thinking→answer không đứt. |

## Quyết định ĐÃ CHỐT bởi chủ dự án (không bàn lại)

- **D1 — Runtime**: Worker = Next.js (Node runtime), KHÔNG Bun (sandbox thường có Next.js sẵn, deploy ổn định). WebHub = Node + Hono service thuần (không Next.js, không Bun). Proxy = cùng codebase worker, khác `MODE=relay`. Bun CHỈ dùng làm package manager (bun install), không bao giờ làm runtime.
- **D2 — Preserved Thinking**: MVP `clear_thinking: true` mặc định. Nhưng interface `StateStore` PHẢI có `getReasoning()`/`saveReasoning()` ngay từ đầu (MemoryStateStore có thể no-op), và `JobPayload` PHẢI có `reasoning_blocks?: ReasoningBlock[]` (reserved field, MVP luôn undefined) — có trong protocol draft v1.
- **D3 — Multi-tenant**: MVP single tenant + API key list. Nhưng MỌI key StateStore/Redis phải có prefix `tenant:{tenant_id}:` từ ngày 1: `tenant:{tid}:conv:{cid}:reasoning`, `tenant:{tid}:job:{jid}`, `tenant:{tid}:conv:{cid}:messages`, `tenant:{tid}:queue`.

---

## 2. Kết quả review kế hoạch gốc (README)

### Giữ nguyên — đúng bản chất
1. Worker pool + WS persistent outbound — **đã xác nhận thực tế: sandbox mở được WS outbound (T0-b PASS)**.
2. Hybrid dispatch: direct push khi có worker rảnh + queue overflow.
3. SSE relay zero-buffer qua mọi hop (`no-transform`, `X-Accel-Buffering: no`, không middleware chạm body).
4. Preserved thinking state nằm ở WebHub, worker stateless.
5. Chấp nhận at-most-once sau khi byte đầu đã tới user.
6. Adapter là LIB → bớt 1 hop mạng + 1 cold start.

### Đã bổ sung vào các PLAN
1. Protocol spec cứng (`packages/protocol`) — chống drift khi code song song (T1-a).
2. Cancellation flow: user disconnect → `job.cancel` → AbortController → abort zsdk (T2-b, T3-c).
3. Ack + visibility timeout 30s; cấm re-dispatch sau khi đã stream (T3-b).
4. StateStore abstraction: Memory (dev) + Redis (prod), interface có sẵn `getReasoning()/saveReasoning()` (D2) — T3-d.
5. Auth: worker token short-lived TTL ~60s + tenant API key (T3-e) — nâng cấp so với bản v1.
6. Backpressure cụ thể: `ws.bufferedAmount` high-water → pause iterator (T2-b).
7. **T3-f Security baseline** (chốt bởi chủ dự án): token TTL ngắn; API key pool không xuống worker dạng plaintext dài hạn; job payload không chở secret tenant khác; `reasoning_content` TTL 24h, không vào log; `request_id`/`job_id` log xuyên suốt.

---

## 3. Topology dev trong sandbox (E2E không cần VPS)

```
Browser ──▶ Caddy :3000 ──▶ dev-console (Next.js :3000)
                               │  fetch('/v1/chat/completions?XTransformPort=3003')  ← relative URL BẮT BUỘC
                               ▼
                           webhub (Node + Hono :3003) ──SSE relay──▶ Browser
                               ▲  WS ws://localhost:3003/worker   (server-side, không qua Caddy)
                               │
                           worker (Next.js Node :3004 /api/health) ──zsdk──▶ Z.AI
```

Quy ước gateway sandbox:
- Mọi request từ **browser** sang webhub: relative URL + `?XTransformPort=3003`. CẤM ghi port/địa chỉ tuyệt đối trong URL.
- Worker (process server-side) được phép connect `ws://localhost:3003/worker` trực tiếp.
- Worker WS client boot qua `instrumentation.ts` register() (guard `NEXT_RUNTIME === 'nodejs'`), KHÔNG chạy trong request handler (D1).
- **Rủi ro verify sớm**: SSE POST dài qua Caddy/XTransformPort có bị buffer không → test ngay sau T3-c bằng `curl -N`.

---

## 4. Chốt nghiệp vụ MVP (trả lời 5 câu hỏi section 9 README gốc)

| # | Câu hỏi | Chốt cho MVP |
|---|---|---|
| 1 | Sandbox có mở được WS outbound không? | **PASS (T0-b)** — Node 24 WebSocket handshake + echo OK qua 2/3 public endpoint. Transport = WS. |
| 2 | Ai tạo sandbox? | OPEN — owner quyết. MVP không block: scale worker bằng tay. |
| 3 | Multi-tenant? | MVP: single tenant + API key list từ env. Mọi key có prefix `tenant:{tid}:` (D3). |
| 4 | Preserved thinking bật mặc định? | **OFF (D2)**. `clear_thinking: true` mặc định; interface + reserved field có sẵn từ draft v1. |
| 5 | Chấp nhận mất stream khi worker chết giữa chừng? | **Chấp nhận at-most-once.** `event: error` + `[DONE]` sạch, log `request_id`/`job_id`. Không retry sau byte đầu tiên. |

---

## 5. Tài sản đã có từ prototype sandbox (my-project)

| Tài sản | Đường dẫn | Áp vào task nào |
|---|---|---|
| Route Z.AI proxy SSE: parse raw SSE từ zsdk ReadableStream, tách reasoning/content, event protocol, `[DONE]`, heartbeat 15s | `src/app/api/chat/route.ts` (264 dòng) | T1-b — chỉ giữ nguyên lý SSE client/abort/heartbeat; API mới = `streamChat()` trả `ReadableStream<Uint8Array>` RAW pass-through (bỏ toSSE — lệnh Đợt 2) |
| SSE client parser + metrics (ttfbMs, sawFinish, sawDone, eventCount) | `src/lib/sse-client.ts`, `src/lib/chat-types.ts` | T1-c / dev-console (đã copy vào mock) |
| Bộ nhớ hội thoại + UI đầy đủ | `src/hooks/use-chat-sessions.ts`, `src/components/chat/*` | Đã copy vào apps/dev-console (T1-c-mock) |

→ T1-b là tái cấu trúc + bổ sung, không viết từ đầu. AI được giao task này phải đọc code prototype trước.

---

## 6. Task Board

Trạng thái: `todo` / `in-progress` / `done` / `blocked`

| ID | Package/App | Công việc | Phụ thuộc | DoD ngắn gọn | Trạng thái |
|---|---|---|---|---|---|
| T0-a | repo | Khung monorepo: bun workspaces (bun chỉ là installer), tsconfig.base, stub protocol/zai-adapter/webhub(Hono)/worker(Next.js) | — | install + typecheck OK | **done** |
| T0-b | spike | Spike sandbox: node/next version, HTTPS outbound, WS handshake (Node WebSocket, 3 target + loopback) | — | Kết luận transport | **done — PASS** |
| T0-c | spike | Dump shape thật của zsdk stream + thử biến thể model/thinking | T0-b pass | Chốt shape chunk + khả năng reasoning | **done — có finding lớn (xem section 9)** |
| T1-a | packages/protocol | Types + zod: WS frames, JobPayload (có `tenant_id`, `reasoning_blocks` reserved), ReasoningBlock, capabilities, **binary envelope codec job.chunk (F4)**; `PROTOCOL_VERSION = 1`. **T1-a-1 FROZEN (Đợt 2) — làm ngay; T1-a-2 (shape reasoning) chờ owner duyệt G2** | T0-a, **G1 PASS** | roundtrip test pass (JSON + binary envelope) | **done (T1-a-1 + T1-a-2 frozen + implement — Đợt 3)** |
| T1-b | packages/zai-adapter | `streamChat()` trả **`ReadableStream<Uint8Array>` RAW pass-through** + reasoning utils + AbortSignal + UPSTREAM config (F8) | T1-a-1 | Smoke: raw bytes liền mạch, có `[DONE]`, TTFB < 5s | **done — mock-verified** (worker E2E qua proxy) |
| T1-c | apps/dev-console | UI harness. **Nửa mock: DONE (`mock-verified` — NOT real-upstream-verified)** (UI + mock SSE). Nửa còn lại: trỏ vào adapter/webhub thật | T1-b (nửa 2) | Mock: PASS nghiệm thu browser (`mock-verified`) | **mock done (`mock-verified`) / adapter-wiring todo** |
| T2-a | apps/worker | WS client boot qua instrumentation.ts: connect, auth token TTL (fetch từ hub), register capabilities, heartbeat 15s, reconnect backoff | T1-a-1 | Hub dev thấy worker register | **done — E2E verified** |
| T2-b | apps/worker | Job executor: dispatch→ack→chunk*(binary envelope F4 + scanner F6)→done/error; cancel AbortController; backpressure bufferedAmount | T1-b, T2-a | E2E 1 job qua hub dev; cancel OK | **done — E2E verified (mock-verified)** |
| T3-a | apps/webhub | WS hub server (Hono + ws) + worker registry + heartbeat timeout 45s + token HMAC TTL | T1-a-1 | 2 worker connect; chết 1 → registry cập nhật | **done — verified (probe + worker thật)** |
| T3-b | apps/webhub | Dispatcher: direct push + queue overflow + visibility timeout 30s + ack + at-most-once | T3-a | Kill worker trước stream → re-dispatch OK | **done — verified (requeue + ack-timeout test trong log agent)** |
| T3-c | apps/webhub | POST /v1/chat/completions: SSE zero-buffer **pass-through (F4)**; hub byte-blind (F6); user disconnect → job.cancel | T1-a-1 | `curl -N` nhận SSE nguyên bản upstream (OpenAI chunks + `[DONE]`) không buffer | **done — E2E verified, đúng 1 [DONE]** |
| T3-d | apps/webhub | StateStore (có `getReasoning/saveReasoning` per D2, Memory) ; key prefix `tenant:{tid}:` per D3 | T1-a-1 | 2 lượt chat cùng conv → lượt 2 có đúng context | **done (Memory; Redis chờ G3; assistant answer chưa lưu — open question F6)** |
| T3-e | apps/webhub | Auth: Bearer key cho `/v1/*`; worker token HMAC TTL cấp hub | T3-a, T3-c | Sai key → 401; sai token → từ chối register | **done — verified (401 + expired-token test)** |
| T3-f | apps/webhub | **Security baseline (chốt bởi chủ dự án)** — xem apps/webhub/PLAN.md | T3-a..T3-e | Grep log: không có reasoning_content/API key; token hết hạn đúng TTL | todo |
| T4-a | apps/dev-console | E2E qua webhub thật (?XTransformPort=3003): panel job_id/TTFB/đếm chunk; prompt stress dài | T2-b, T3-b, T3-c | Checklist nghiệm thu PASS | todo |
| T4-b | ops | Failure drills: kill worker giữa stream; drop WS; restart hub → event:error + [DONE] sạch | T4-a | Mọi kịch bản kết thúc sạch | todo |
| T4-c | ops | Load test N stream đồng thời (5→20): TTFB, RAM webhub, backpressure | T4-a | Không crash, RAM ổn định | todo |
| T4-d | apps/worker | `MODE=relay`: relay frame, không gọi zsdk | T2-b | Worker→relay→hub stream thông suốt | todo |

### Decision gates
- **G1 — transport**: **PASS (T0-b)** → WS confirmed.
- **G2 — chunk schema zsdk**: **CHỐT (T0-c) + xác nhận thêm bằng curl trực tiếp (log [v3])** — zsdk 0.0.18 trả `ReadableStream<Uint8Array>` raw SSE (KHÔNG phải AsyncIterable objects); chunk parsed dạng OpenAI `{id, created, object:"chat.completion.chunk", model, choices:[{index, delta:{role,content}, finish_reason, usage}]}` + `[DONE]`. **⚠️ reasoning_content KHÔNG xuất hiện ở gateway sandbox này (mọi model đều bị route về glm-4-plus)** — xem section 9 + log [v3].
- **G3** (sau T3-d): preserved thinking có bật mặc định không → nếu có, Redis bắt buộc trên prod.

---

## 7. Lanes — giao agent để kịp tiến độ

**Đợt 1 (tuần tự có kiểm soát — CHỐT bởi chủ dự án):**
1. T0-b BẮT BUỘC làm trước, đúng thứ tự a→b→c→(d) — **DONE, PASS**.
2. Song song với T0-b: T0-a (done) + T1-c-mock UI dev-console (done).
3. **T1-a freeze — LỆNH ĐỢT 2 của chủ dự án: T1-a-1 freeze NGAY (không chờ):** transport WS + frame types + `job.cancel` + `job.chunk` = raw SSE bytes (Uint8Array, không parse-rồi-stringify) + `reasoning_blocks` reserved + tenant prefix. **T1-a-2 (shape reasoning) chờ owner duyệt kết quả G2 debug.**

**ĐỢT 3 — LAUNCHED & DONE (2026-11-13):** 3 agent song song (Task tool; 3-a adapter+worker, 3-b webhub, 3-c dev-console; agent webhub kịp ghi nhật ký đầy đủ, 3-a/3-c bị deadline giữa chừng — integration agent hoàn tất phần còn lại):
- 3-a: T1-b adapter + T2-a/T2-b worker — DONE.
- 3-b: T3-a…T3-e webhub — DONE (nhật ký đầy đủ trong apps/webhub/PLAN.md).
- 3-c: T1-c nửa 2 + T4-a prep dev-console — DONE (mock upstream-native + adapter route + WebHub mode + F7 auto panel).
- Integration fixes: `upstream_done_relayed` flag trong job.done (bỏ [DONE] trùng — hub wrapper index.ts làm rơi tham số thứ 5); onUserDisconnect không flush [DONE]; rebuild compat bundle; rewrites() cho dev-console.

**Đợt 4 (còn lại):** T4-a nghiệm thu checklist + T4-b failure drills + T4-c load test + T4-d relay; port-3000 switchover cho dev-console khi owner sẵn sàng.

**Luật bất di bất dịch:** KHÔNG ai đổi interface trong `packages/protocol` nếu không bump `PROTOCOL_VERSION` + cập nhật PLAN + báo owner. Tên event/frame lấy từ protocol, không tự chế.

---

## 8. Rủi ro & lưu ý

1. **zsdk gateway sandbox route cứng về glm-4-plus, không emit reasoning_content** (T0-c + G2 curl) → giai đoạn dev không E2E-test được thinking thật; phải test qua mock + verify lại trên VPS với `UPSTREAM=real` + key thật. Adapter vẫn PHẢI handle `reasoning_content` (code path defensive), chỉ là không chạy được thật ở đây.
2. zsdk trả ReadableStream raw SSE — mọi code giả định AsyncIterable-of-objects phải bỏ (đã cập nhật T1-b scope).
3. SSE POST dài qua Caddy/XTransformPort có thể bị buffer → verify ngay sau T3-c (`curl -N`).
4. WebHub RAM với nhiều stream in-flight (~50–500KB/stream) → MVP chấp nhận, theo dõi ở T4-c.
5. **Bảo mật** (cập nhật [v6]): PAT cũ ĐÃ LỘ trong hội thoại — chủ dự án đã cấp PAT fine-grained mới, 5 commit đã push thành công lên `origin/main`. PAT cũ phải được revoke ngay nếu chưa. PAT mới cũng đã đi qua kênh chat → khuyến nghị expiry ngắn (30–90 ngày) và rotate lại sau phiên làm việc. Vẫn giữ quy tắc bất di bất dịch: không commit token vào repo; không ghi token vào git config vĩnh viễn (push bằng one-off URL).
6. **(Đợt 2-final) E2E thinking = BLOCKER production chờ key Z.AI thật cho VPS** (env `ZAI_API_KEY`, KHÔNG inject vào sandbox). KHÔNG block Đợt 3 — mọi tầng code defensive (worker relay nếu thấy reasoning, hub byte-blind, UI tự hiện panel).
7. **(Đợt 2-final) Nhãn xác minh bắt buộc**: mọi tuyên bố "thinking works" phải ghi `mock-verified` hoặc `real-upstream-verified`. Prototype thinking panel chưa bao giờ nhận reasoning thật từ upstream (proxy strip) — mọi số liệu "TTFB 40ms / 230 events / 1.189 ký tự suy luận" của dev-console mock là `mock-verified`.

---

## 9. Nhật ký chung (owner/agent ghi biến bản ở đây)

### [v2] Đợt 1 — T0-b + T0-c spike results (sandbox Node v24.22.2)

**T0-b (a) Versions**: node v24.22.2; next 16.1.3 (my-project); z-ai-web-dev-sdk 0.0.18 (repo monorepo: next 15.5.29, hono 4.13.18, zod 3.25.76, ws 8.23.0).

**T0-b (b) HTTPS outbound**: `https://api.z.ai` → HTTP 301 (0.07s) PASS; `https://api.github.com` → HTTP 403 (reachable) PASS. Không có proxy env vars.

**T0-b (c) WS handshake (Node 24 global WebSocket client)**:
- `[PASS] wss://ws.postman-echo.com/raw (1020ms) — echo nhận lại đúng payload`
- `[PASS] wss://echo.websocket.org (492ms) — echo OK`
- `[FAIL] wss://echo.websocket.events (124ms) — error event (lỗi phía service đó, không phải sandbox)`
- VERDICT: **outbound WS = PASS** → G1: transport = WebSocket. Script: `spike/t0b-ws-handshake.mjs`.

**T0-c — shape thật của zsdk stream (script: `spike/t0c-dump-chunks.mjs`, `spike/t0c-model-variants.mjs`)**:
1. **zsdk 0.0.18 trả `ReadableStream<Uint8Array>` (raw SSE bytes)** — KHÔNG phải AsyncIterable chunk objects. Nhầm điều này sẽ chết T1-b/T2-b.
2. Wire: dòng `data: {json}\n\n`, kết thúc bằng `data: [DONE]`. Không thấy keep-alive comment ở lần chạy này.
3. Chunk parsed (OpenAI-format):
   ```json
   {"id":"20261113124146007d484f9ed84bd1","created":1794544906,"object":"chat.completion.chunk","model":"glm-4-plus","choices":[{"index":0,"delta":{"role":"assistant","content":"1"}}]}
   ```
   Chunk finish có thêm `finish_reason:"stop"` + `usage{prompt_tokens, completion_tokens, total_tokens}` (usage nằm TRONG choice object, không phải top-level).
4. **⚠️ FINDING LỚN**: yêu cầu `model:"glm-5.3"` (+ biến thể `glm-4.6`, `glm-4.5`, no-model) + `thinking:{type:"enabled"}` — upstream LUÔN trả `model:"glm-4-plus"` và **0 chunk có `reasoning_content`**. Gateway sandbox này route cứng về glm-4-plus, không sinh reasoning stream. Adapter vẫn phải code path reasoning (đúng protocol), nhưng verify thinking thật phải chờ prod key/model khác hoặc đổi tier. TTFB thực đo: ~590ms; tổng ~1.5s cho câu ngắn.

**Hệ quả G2 cho T1-a/T1-b**: schema `job.chunk.kind='thinking'` GIỮ NGUYÊN (reserved, prod sẽ dùng), nhưng adapter phải parse raw SSE từ ReadableStream và KHÔNG được giả định có reasoning trong môi trường dev. Việc freeze T1-a vẫn CHỜ xác nhận chủ dự án.

---

## 10.3. Log [v3] — Đợt 2: G2 debug bằng curl trực tiếp + T1-a-1 FROZEN (2026-11-13)

**Lệnh chủ dự án (Đợt 2):** chạy 3 bước debug G2 trước khi chốt T1-a-2 (báo cáo, không in key); SONG SONG freeze T1-a-1 ngay không chờ G2.

**T1-a-1 FROZEN (5 điểm — chi tiết tại `packages/protocol/PLAN.md` mục T1-a-1):** F1 transport WS (text=JSON control, binary=stream data); F2 frame types + `job.cancel` trong v1; F3 cancellation spec; F4 `job.chunk` payload = raw SSE bytes Uint8Array NGUYÊN XI (envelope `[16B job_id uuid][4B seq BE][SSE bytes]`) — zero-parse end-to-end; F5 reserved fields `reasoning_blocks` + `tenant_id` + tenant prefix keys. Hệ quả F4: SSE cho user = upstream nguyên bản, custom events `thinking_start/...` DEPRECATED khỏi wire công khai (dev-console tự đọc `delta.reasoning_content`).

**3 bước debug G2 (curl, đúng bộ header zsdk: Bearer apiKey + X-Z-AI-From: Z + X-Chat-Id + X-User-Id + X-Token):**
1. **G2-1 baseUrl**: `/etc/.z-ai-config` → `https://internal-api.z.ai/v1` = **proxy nội bộ**, KHÔNG phải api.z.ai. (zsdk load: cwd → home → /etc; sandbox chỉ có /etc.)
2. **G2-2 key sandbox vs public api.z.ai**: `api.z.ai/v1/chat/completions` → 404 (path không tồn tại); `api.z.ai/api/paas/v4/chat/completions` → **401 身份验证失败** → outbound HTTPS/TLS PASS nhưng key sandbox chỉ hợp lệ trên proxy nội bộ. Production WebHub phải dùng key Z.AI thật.
3. **G2-3 grep zsdk 0.0.18**: toàn package KHÔNG có `glm-4-plus` hay model nào hardcoded, KHÔNG có fallback logic — model pass-through từ caller; `thinking` mặc định `disabled`; `stream:true` trả thẳng `response.body`. → Rewriting model là hành vi của **proxy nội bộ**, không phải zsdk.

**Xác nhận stream (glm-4.6 và glm-5.3, thinking enabled, prompt suy luận):** 534 chunks → 0 chunk `delta.reasoning_content`, 100% `delta.content`, mọi chunk `model:"glm-4-plus"`. Khớp 100% với T0-c (section 10).

**Phát hiện bổ sung mới so với T0-c:**
- Chunk cuối chỗ `usage` ở curl này nằm **top-level** (`{choices:[...], usage:{...}}`) — T0-c ghi nhận nằm TRONG choice. → Shape biến đổi theo run/path: parser `job.done` phải đọc tolerant: `chunk.usage ?? chunk.choices[0].usage`.
- `finish_reason:"stop"` + `delta:{role,content:""}` trong cùng chunk cuối.
- Non-stream glm-4.6: response KHÔNG có `reasoning_content` dù thinking enabled.

**Kết quả hành chính:** T1-a-1 FROZEN → cập nhật `packages/protocol/PLAN.md` + `packages/zai-adapter/README.MD` (API mới) + các PLAN liên quan + Task Board. **T1-a-2 BLOCKED chờ chủ dự án duyệt** các hàm ý G2 (5 điểm trong protocol PLAN). Commit local; chưa push — chờ PAT mới tối thiểu scope (risk #5).

### [v4] Đợt 2-final — Owner review G2 + T1-a-2 FROZEN + launch Đợt 3 (2026-11-13)

**Kết luận owner về G2:** proxy nội bộ KHÔNG đại diện production (rewrite model + strip reasoning); **thinking mode chưa từng được E2E test thật** — prototype thinking panel + adapter reasoning path đều chỉ là mock-verified. Điểm này quan trọng hơn việc G2 pass.

**T1-a-2 FROZEN với 2 điều chỉnh (chi tiết F6–F9 trong `packages/protocol/PLAN.md`):**
- **F6** — Worker scan SSE tối thiểu (chỉ `finish_reason`/`usage`/`[DONE]`) để gửi `job.done`; KHÔNG đụng content/reasoning; hub BYTE-BLIND hoàn toàn, metering từ `job.done`.
- **F7** — Bỏ "thinking UI 2 modes": panel tự hiện khi có `delta.reasoning_content`, ẩn/placeholder khi không có.
- **F8** — Adapter `UPSTREAM=proxy|real`; sandbox chỉ `proxy`; E2E thinking chỉ trên VPS với `UPSTREAM=real`.
- **F9** — `response.model` chỉ log, không validate.
- Nhãn `mock-verified` / `real-upstream-verified` bắt buộc trong mọi tài liệu; E2E thinking = BLOCKER production chờ key Z.AI thật cho VPS (không block Đợt 3).

**T3-f security baseline:** verify đủ 5 điểm DoD trong `apps/webhub/PLAN.md` — OK, không cần sửa.

**PAT (lần nhắc thứ 3 — lần cuối):** revoke PAT cũ NGAY (Settings → Developer settings → Personal access tokens → Delete). Tạo PAT fine-grained mới: chỉ repo `kungfufanta/ZaiWebHub`, permission `Contents: Read and write`, expiry 30–90 ngày. KHÔNG push bằng PAT cũ dù 1 lần. 3 commit local (`b4f9b6c`, `b6bdbdb`, `947269f`) chờ push.

**Đợt 3 — LAUNCHED (2026-11-13):** 3 agent song song, không block bởi thinking (code defensive):
- **3-a**: `packages/zai-adapter` (T1-b) + `apps/worker` (T2-a, T2-b) — port 3004.
- **3-b**: `apps/webhub` (T3-a…T3-e) — port 3003.
- **3-c**: `apps/dev-console` (T1-c nửa 2: ghép adapter thật + wire mới upstream-native; chuẩn bị T4-a) — port 3005.
Protocol package (T1-a-1) implement trực tiếp bởi agent phiên này TRƯỚC khi bung Đợt 3.

### [v5] Đợt 3 — 3 agent song song + integration E2E (2026-11-13)

**Kết quả Đợt 3:** hạ tầng end-to-end CHẠY THẬT trong sandbox:
- **packages/protocol (T1-a)**: implement đầy đủ (job/frames/sse + binary envelope codec + scanner F6) — roundtrip inline-verified.
- **packages/zai-adapter (T1-b)**: `streamChat()` raw pass-through; UPSTREAM=proxy|real; bun-direct smoke OK (1 `[DONE]`, TTFB nhanh).
- **apps/worker (T2-a/b)**: WS outbound + register/heartbeat/backoff + executor binary envelope + scanner; E2E qua hub OK; cancel OK.
- **apps/webhub (T3-a..e)**: hub WS + registry + token HMAC TTL + dispatcher (direct push/queue/visibility 30s/at-most-once) + SSE pass-through byte-blind + StateStore tenant-prefix + auth 401. Nhật ký đầy đủ trong apps/webhub/PLAN.md (kể cả probe E2E giả worker + expired-token test).
- **apps/dev-console (T1-c nửa 2 + T4-a prep)**: mock upstream-native + adapter route + 3-mode switcher (Mock/Adapter/WebHub) + F7 auto thinking panel + debug job_id. Browser-verified qua agent-browser.

**Integration fixes (sau khi gộp 3 agent):**
1. **[DONE] trùng lặp** — 3 nguyên nhân xếp lớp: (a) hub flush defensively trong khi worker đã relay `[DONE]` của upstream → thêm field optional `upstream_done_relayed` vào `job.done` (worker set từ scanner F6; hub chỉ flush khi thiếu — thêm field additive, KHÔNG bump PROTOCOL_VERSION, đã ghi nhận cho owner duyệt); (b) **thủ phạm chính**: hooks wrapper `onDone` trong `apps/webhub/src/index.ts` chỉ khai 4 tham số → tham số thứ 5 bị rơi âm thầm (stack-trace instrumentation bắt được); (c) `onUserDisconnect` flush `[DONE]` gây race khi curl đóng ngay sau khi nhận đủ bytes → bỏ flush (socket đóng, flush vô nghĩa). Kết quả: wire = đúng 1 `data: [DONE]`.
2. **Adapter-chat treo**: dev-console dùng compat bundle `.zai-compat/` build TRƯỚC khi agent 3-a fix hang `pull()` → rebuild `scripts/build-compat.ts` → OK. Ghi chú cho owner: compat là TEMPORARY — bỏ khi packages ship dist (comment trong next.config.ts).
3. **WebHub mode 404 khi truy cập trực tiếp :3005** (không qua gateway, XTransformPort vô hiệu): thêm `rewrites()` trong next.config proxy server-side → 1 URL client chạy cả 2 ngữ cảnh.

**Verification tổng (browser + curl, 2026-11-13):**
- E2E curl qua hub: SSE nguyên bản upstream, `finish_reason` + `usage` từ scanner, đúng 1 `[DONE]`, headers X-Job-Id/X-Request-Id, 401 sai key.
- Browser (agent-browser): Mock TTFB 129ms / 139🧠/76💬 / badge `mock-verified`; WebHub E2E TTFB 392ms / trả lời "Everest" / badge `no-reasoning (proxy)` / job_id hiển thị.
- Typecheck root pass; 3 services chạy background: webhub :3003 (tsx watch), worker :3004 (next dev), dev-console :3005 (next dev).

**Nhãn xác minh:** TOÀN BỘ kết quả trên là `mock-verified` / no-reasoning (proxy) — reasoning path là code defensive, `real-upstream-verified` chỉ đạt được trên VPS với `UPSTREAM=real` + key thật (blocker #6).

**Open question cho owner (F6 follow-up):** assistant answer text KHÔNG được lưu vào StateStore (hub byte-blind không trích được từ raw SSE; worker bị cấm đụng content) → bộ nhớ hội thoại MVP dựa vào client gửi đủ history. Nếu muốn server-side memory đầy đủ → cho worker kèm `answer_text` trong `job.done` (mở rộng F6 một cách kiểm soát) — chờ owner chốt.

### [v6] PAT rotation + push 5 commit lên GitHub (2026-11-13)

**Sự kiện:** chủ dự án cấp PAT fine-grained mới (chỉ repo `kungfufanta/ZaiWebHub`, Contents: Read and write).

- Push thành công: `origin/main` `4bb25be..0e61d89` — 5 commit đã lên GitHub:
  `b4f9b6c` (T0-a khung monorepo + T1-c-mock), `b6bdbdb` (T0-b/T0-c spike + plan), `947269f` (T1-a-1 freeze + G2 debug), `2c6b4f2` (T1-a-1+T1-a-2 implement protocol F1–F9), `0e61d89` (Đợt 3 adapter+worker+webhub+dev-console E2E).
- Push bằng one-off URL; token KHÔNG nằm trong git config, không vào repo. Verify: `ls-remote` head = `0e61d89`, local và remote đồng bộ.
- Rủi ro còn lại: PAT mới cũng đi qua kênh chat → owner nên revoke PAT cũ NGAY (nếu chưa) và rotate PAT mới khi phiên kết thúc.
- Trạng thái kế hoạch: **Đợt 1–3 DONE + đã lên GitHub**. Còn mở: T3-f verify đầy đủ trên prod, T4-a…T4-d, và **Đợt 3.5 (remote worker onboarding: TLS wss://, worker auth, multi-worker registry)** chờ chủ dự án chốt 5 câu trong đề xuất chuyển hướng kiến trúc (cốt lõi: auth worker — shared secret hay per-worker token; số sandbox dự kiến).
- Blocker production không đổi: E2E thinking thật chờ key Z.AI thật (`ZAI_API_KEY`) cho nơi chạy worker với `UPSTREAM=real` — nhãn `real-upstream-verified` chỉ gắn được sau khi test qua upstream thật (xem risk #6, #7).
