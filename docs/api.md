# ZaiWebHub — Hub API Reference (webhub :3003)

> Tài liệu API của hub. Mọi endpoint trả JSON `application/json`, trừ `/v1/chat/completions`
> (SSE `text/event-stream`).
>
> **Base URL:**
> - Nội bộ sandbox hub: `http://127.0.0.1:3003`
> - Qua gateway công cộng: `https://<hub-host>/<path>?XTransformPort=3003`
>   (gateway Caddy forward theo query `XTransformPort`, hỗ trợ cả WebSocket upgrade)
>
> Nguồn sự thật của wire contract: `packages/protocol` (zod schemas — 2 đầu validate).

---

## 1. Authentication

| Nhóm endpoint | Cơ chế | Header |
|---|---|---|
| `/v1/*` (chat cho user/client) | Bearer tenant key | `Authorization: Bearer <key>` — key khớp env `TENANT_KEYS` của hub (dev mặc định: `zhb_dev_default_key`, mọi key hợp lệ map tenant `default`) |
| `/internal/*` (worker-token, workers) | Shared secret | `X-Worker-Secret: <WORKER_SECRET>` — khớp env `WORKER_SECRET` của hub (timing-safe compare). Thiếu/sai → **401** |
| `/healthz` | Không auth | — |
| `/worker` (WS) | Hub-mint token trong frame đầu (xem §5) | — |

> ⚠️ Hub không set `WORKER_SECRET` → `/internal/*` KHÔNG gate (dev loopback only) — cấm expose công khai.

---

## 2. `GET /healthz`

Liveness probe.

```bash
curl -s 'https://<hub-host>/healthz?XTransformPort=3003'
```

```json
{ "ok": true, "service": "webhub", "ts": 1794558892225 }
```

---

## 3. `POST /v1/chat/completions` — SSE chat (OpenAI-style)

Endpoint duy nhất user/client chạm tới. Hub **BYTE-BLIND** (F6): chunk bytes của upstream được
relay NGUYÊN XI — hub không parse/re-stringify; kết thúc stream chỉ đến từ `job.done`/`job.error`.

### Request

```bash
curl -N -X POST 'https://<hub-host>/v1/chat/completions?XTransformPort=3003' \
  -H 'Authorization: Bearer zhb_dev_default_key' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "glm-5.3",
    "messages": [{"role": "user", "content": "Xin chào"}],
    "stream": true,
    "conversation_id": "optional-id-để-có-bộ-nhớ"
  }'
```

| Field | Type | Bắt buộc | Ghi chú |
|---|---|---|---|
| `messages` | `Array<{role, content}>` | ✅ | role: `system`/`user`/`assistant`, content **string**; message sai shape bị drop; rỗng hết → 400. Có `conversation_id` → history của phiên được prepend (bộ nhớ hội thoại) |
| `stream` | boolean | ✅ `true` | MVP chỉ hỗ trợ SSE pass-through — khác → 400 |
| `model` | string | — | mặc định `glm-5.3` |
| `conversation_id` | string | — | bật bộ nhớ hội thoại: user messages được lưu, history prepend lần sau |
| `thinking` | `{type: "enabled"\|"disabled"}` | — | mặc định `enabled` |
| `clear_thinking` | boolean | — | mặc định `true` |
| `max_tokens` | int > 0 | — | — |
| `temperature` | 0–2 | — | — |

### Response (200 — SSE stream)

Headers:

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
X-Job-Id: <uuid>        # để trace / đối chiếu hub log
X-Request-Id: <uuid>
```

Wire format — **nguyên bản upstream** (thứ tự điển hình):

```
data: {"choices":[{"delta":{"reasoning_content":"..."}}], ...}   ← thinking chunks (nếu upstream có)
data: {"choices":[{"delta":{"content":"..."}}], ...}             ← answer chunks
data: {"choices":[{"delta":{},"finish_reason":"stop"}], "usage": {...}, ...}  ← chunk cuối
data: [DONE]
```

Quy tắc kết thúc: **đúng 1 dòng `data: [DONE]`** (hub flush defensively khi worker không relay).
Client disconnect giữa chừng → hub gửi `job.cancel` cho worker (không re-dispatch nếu đã streaming).

### Lỗi

**HTTP JSON (trước khi stream bắt đầu):**

| HTTP | Trường hợp |
|---|---|
| 400 | body không phải JSON; sai schema (`messages` rỗng/sai shape, `max_tokens` <= 0, `temperature` ngoài 0–2…); `stream` khác `true`; không còn message hợp lệ; job payload fail schema |
| 401 | thiếu/sai `Authorization: Bearer <key>` → `{"error":{"message":"invalid api key"}}` |

**Frame lỗi TRONG stream** (sau 200 — worker chết giữa stream / job fail sau chunk đầu):

```
event: error
data: {"error":{"message":"upstream connection lost (worker died midstream)","type":"upstream_error"}}

data: [DONE]
```

`type` ∈ `upstream_error | cancelled | timeout | quota | unknown`.

### Dispatch behavior (để hiểu độ trễ)

- Least-loaded: job đi worker có `inflight` thấp nhất (tie → worker đăng ký trước).
- Không worker rảnh → job vào queue, tự drain khi worker nhả slot.
- Job chưa có chunk đầu → được re-dispatch tối đa **1 lần** (worker chết/ack-timeout 30s).
- Đã có chunk đầu → **at-most-once**, không re-dispatch.

---

## 4. `GET /internal/workers` — snapshot registry + stats (3.6-H)

Đọc trạng thái worker pool — nguồn dữ liệu của tab `/workers` + `/stats` trên Hub UI.

```bash
curl -s 'https://<hub-host>/internal/workers?XTransformPort=3003' \
  -H 'X-Worker-Secret: <WORKER_SECRET>'
```

**200:**

```json
{
  "workers": [
    {
      "id": "w2-c-6af6b9ae-140d72b5-5aff54cafef5",
      "worker_id": "w2-c-6af6b9ae-140d72b5-5aff54cafef5",
      "status": "online",
      "connected_at": 1794558913028,
      "last_heartbeat": 1794558958030,
      "inflight": 0,
      "total_jobs": 2,
      "capabilities": {
        "worker_id": "w2-…", "tenant_id": "default",
        "models": ["glm-5.3"], "concurrency": 2, "protocol_version": 1
      }
    }
  ],
  "uptime_seconds": 76,
  "total_jobs_all_time": 2
}
```

| Field | Ý nghĩa |
|---|---|
| `workers[].id` | worker_id (`worker_id` giữ lại cho tiện debug — cùng giá trị) |
| `workers[].status` | `online` (đang trong registry) / `offline` (mất kết nối ≤ 15 phút, quá TTL rơi khỏi danh sách) |
| `connected_at` | epoch ms — mốc connection hiện tại (re-register cập nhật mới) |
| `last_heartbeat` | epoch ms — authoritative từ registry khi online |
| `inflight` | số slot đang dùng (cap = `capabilities.concurrency`) |
| `total_jobs` | số job DUY NHẤT worker đã nhận (đếm theo `job.ack`, dedupe toàn hub) |
| `total_jobs_all_time` | tổng job duy nhất đã tới tay mọi worker |
| `uptime_seconds` | uptime tiến trình hub |

**401** khi thiếu/sai `X-Worker-Secret`:

```json
{ "error": { "message": "worker secret required (header X-Worker-Secret)" } }
```

---

## 5. `GET /internal/worker-token` — mint token cho worker WS

Worker gọi endpoint này đầu tiên (kèm `X-Worker-Secret`) để lấy HMAC token TTL ngắn, rồi dùng
trong frame `worker.register`.

```bash
curl -s 'https://<hub-host>/internal/worker-token?XTransformPort=3003' \
  -H 'X-Worker-Secret: <WORKER_SECRET>'
```

| Query | Mặc định | Ghi chú |
|---|---|---|
| `tenant_id` | `default` | phải khớp `capabilities.tenant_id` lúc register |
| `ttl` | `60` | giây, kẹp trong `[5, 300]` |

**200:** `{ "token": "<payload>.<sig>", "tenant_id": "default", "ttl_seconds": 60, "expires_at": 1794558972000 }`
**401:** sai/thiếu `X-Worker-Secret`.

---

## 6. WS `/worker` — worker protocol (tóm tắt)

Worker TỰ connect outbound tới `wss://<hub-host>/worker?XTransformPort=3003`. Upgrade tại path
khác → socket destroy. Frame **đầu tiên** phải là `worker.register` hợp lệ (token + tenant +
protocol_version khớp) — sai bất cứ điều nào → close **4401**.

JSON TEXT frames (control) — schema trong `packages/protocol/src/frames.ts`:

| Chiều | Frame | Ghi chú |
|---|---|---|
| W → H | `worker.register {type, capabilities, token}` | capabilities: `{worker_id, tenant_id, models[], concurrency, protocol_version}`; duplicate worker_id → connection cũ close 4409 |
| W → H | `worker.heartbeat {type, ts, inflight}` | inflight authoritative; heartbeat > **45s** → sweep coi worker chết (sweep mỗi 10s) |
| W → H | `job.ack {type, job_id}` | phải tới trong **30s** sau dispatch (visibility timeout) |
| W → H | binary `job.chunk` | envelope F4: `[16B job_id][4B seq BE][raw SSE bytes nguyên xi]`, header 20 bytes |
| W → H | `job.done {type, job_id, finish_reason, usage?, upstream_done_relayed?}` | `upstream_done_relayed:true` → hub không flush thêm `[DONE]` |
| W → H | `job.error {type, job_id, error:{message, type}}` | trước chunk đầu → requeue (max 1 re-dispatch); sau chunk → `event:error` + `[DONE]` cho client |
| H → W | `job.dispatch {type, job}` | job: JobPayload đầy đủ |
| H → W | `job.cancel {type, job_id, reason?}` | user disconnect / hub cancel |
| H → W | `hub.ping {type, ts}` | keepalive |

Chi tiết đầy đủ: `packages/protocol/src/frames.ts` + `packages/protocol/PLAN.md`.

---

## 7. Server-side routes của Hub UI (dev-console :3000)

Console KHÔNG expose secret qua static asset — mọi gì chạm secret đi qua server-side proxy:

| Route | Vai trò |
|---|---|
| `GET /api/workers` | Proxy → webhub `/internal/workers` với header `X-Worker-Secret` từ env `WORKER_SECRET` của console (server-side) — client chỉ thấy JSON workers, không thấy secret. Tab `/workers` + `/stats` poll route này mỗi 5s |
| `GET /api/worker-secret` | Trả `{set, worker_secret, hint}` từ env console — phục vụ box **WORKER_SECRET** trên tab `/workers` (owner copy secret khi onboard worker). Mô hình bảo mật: public preview URL của sandbox là lớp bảo vệ (đã chốt ở 3.6-H). Route không log secret |
| `POST /v1/chat/completions` (rewrite) | Console WebHub mode fetch relative `/v1/chat/completions?XTransformPort=3003` — qua gateway đi thẳng hub; truy cập trực tiếp → Next rewrite server-side sang `http://localhost:3003` |

Env console liên quan (đặt trong `.env.local`, gitignored): `WORKER_SECRET`, `HUB_INTERNAL_URL`
(mặc định `http://127.0.0.1:3003`).

---

## 8. Bảng tổng hợp mã lỗi

| HTTP | Endpoint | Nguyên nhân |
|---|---|---|
| 400 | `/v1/chat/completions` | body/schema/stream/messages/payload không hợp lệ |
| 401 | `/v1/chat/completions` | sai/ thiếu Bearer key |
| 401 | `/internal/worker-token`, `/internal/workers` | thiếu/sai `X-Worker-Secret` |
| 404 | bất kỳ | path không tồn tại (`{"error":{"message":"not found"}}`) |
| WS 4401 | `/worker` | frame đầu không phải register hợp lệ / token hết hạn / tenant sai / protocol_version sai |
| WS 4409 | `/worker` | duplicate worker_id (connection cũ bị thay) |
| SSE `event: error` | `/v1/chat/completions` | lỗi sau khi stream bắt đầu (worker chết giữa stream…) — luôn kèm `data: [DONE]` kết thúc sạch |
