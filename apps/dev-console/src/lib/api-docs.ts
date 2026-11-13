/**
 * api-docs.ts (3.7-D) — NGUỒN SỰ THẬT DUY NHẤT cho nội dung tab "Docs" của Hub UI
 * và cho site docs static (scripts/export-docs-site.ts → GitHub Pages).
 *
 * Quy tắc:
 * - Thuần data, KHÔNG import gì cả (bun script import trực tiếp được).
 * - Text đặt trong backtick `...` sẽ render thành inline <code>.
 * - Placeholder `{HUB}` trong code block: trang React thay bằng origin hiện tại
 *   (window.location.origin) sau mount; site static thay bằng `https://<hub-host>`.
 * - KHÔNG BAO GIỜ nhét WORKER_SECRET thật vào đây — luôn dùng placeholder <WORKER_SECRET>.
 * - Nguồn tham chiếu wire contract: docs/api.md + packages/protocol.
 */

export type CodeLang = 'bash' | 'json' | 'text' | 'js' | 'python';
export type HttpMethod = 'GET' | 'POST' | 'SSE' | 'WS';

export interface DocParaBlock {
  kind: 'p';
  text: string;
}
export interface DocListBlock {
  kind: 'list';
  items: string[];
}
export interface DocTableBlock {
  kind: 'table';
  headers: string[];
  rows: string[][];
}
export interface DocNoteBlock {
  kind: 'note';
  tone: 'info' | 'warn';
  text: string;
}
export interface DocCodeBlock {
  kind: 'code';
  lang: CodeLang;
  title?: string;
  code: string;
}

export type DocBlock = DocParaBlock | DocListBlock | DocTableBlock | DocNoteBlock | DocCodeBlock;

export interface DocEndpoint {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  blocks: DocBlock[];
}

export interface DocSection {
  id: string;
  title: string;
  blurb?: string;
  blocks?: DocBlock[];
  endpoints?: DocEndpoint[];
}

export const DOC_META = {
  title: 'API Reference',
  subtitle: 'Tài liệu API của ZaiWebHub hub — tương thích OpenAI Chat Completions (SSE)',
  badge: 'OpenAI-compatible · SSE',
  source: 'docs/api.md',
} as const;

export const API_DOCS: DocSection[] = [
  {
    id: 'overview',
    title: 'Tổng quan',
    blurb: 'Hub cung cấp endpoint chat kiểu OpenAI (`POST /v1/chat/completions`, SSE) + API nội bộ cho worker pool.',
    blocks: [
      {
        kind: 'p',
        text: 'Base URL qua gateway công cộng của sandbox hub: `https://<hub-host>/<path>?XTransformPort=3003` — gateway Caddy forward theo query `XTransformPort`, hỗ trợ cả WebSocket upgrade. Trong nội bộ sandbox hub: `http://127.0.0.1:3003`. Trang này tự điền base URL hiện tại của bạn vào ví dụ (thay `{HUB}`).',
      },
      {
        kind: 'code',
        lang: 'bash',
        title: 'Quickstart — gọi chat bằng curl',
        code: `curl -N -X POST '{HUB}/v1/chat/completions?XTransformPort=3003' \\
  -H 'Authorization: Bearer zhb_dev_default_key' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "glm-5.3",
    "messages": [{"role": "user", "content": "Xin chào"}],
    "stream": true,
    "conversation_id": "demo-1"
  }'`,
      },
      {
        kind: 'note',
        tone: 'info',
        text: '`zhb_dev_default_key` là key dev CÔNG KHAI theo thiết kế sandbox (MVP single tenant — không phải secret). Production: set env `TENANT_KEYS` trên hub để cấp key riêng cho từng tenant.',
      },
    ],
  },
  {
    id: 'authentication',
    title: 'Xác thực',
    blocks: [
      {
        kind: 'table',
        headers: ['Nhóm endpoint', 'Cơ chế', 'Header'],
        rows: [
          ['`/v1/*` (chat cho client)', 'Bearer tenant key', '`Authorization: Bearer <key>` — khớp env `TENANT_KEYS` của hub'],
          ['`/internal/*` (worker-token, workers)', 'Shared secret', '`X-Worker-Secret: <WORKER_SECRET>` — timing-safe compare'],
          ['`/healthz`', 'Không auth', '—'],
          ['`/worker` (WS)', 'Hub-mint token trong frame đầu', '— (xem mục WS)'],
        ],
      },
      {
        kind: 'note',
        tone: 'warn',
        text: 'Thiếu/sai key hoặc secret → HTTP **401**. `WORKER_SECRET` là secret thật: KHÔNG commit, KHÔNG nhét vào code client, KHÔNG log giá trị.',
      },
    ],
  },
  {
    id: 'healthz',
    title: 'GET /healthz',
    endpoints: [
      {
        id: 'healthz-endpoint',
        method: 'GET',
        path: '/healthz',
        summary: 'Liveness probe — không cần auth.',
        blocks: [
          {
            kind: 'code',
            lang: 'bash',
            title: 'Request',
            code: `curl -s '{HUB}/healthz?XTransformPort=3003'`,
          },
          {
            kind: 'code',
            lang: 'json',
            title: 'Response 200',
            code: `{ "ok": true, "service": "webhub", "ts": 1794558892225 }`,
          },
        ],
      },
    ],
  },
  {
    id: 'chat',
    title: 'POST /v1/chat/completions',
    blurb: 'Endpoint duy nhất client chạm tới — tương thích OpenAI Chat Completions ở chế độ stream. Hub BYTE-BLIND: chunk upstream được relay NGUYÊN XI, hub không parse/re-stringify.',
    endpoints: [
      {
        id: 'chat-request',
        method: 'SSE',
        path: '/v1/chat/completions',
        summary: 'Chat stream SSE — ngắt dòng `data:` nguyên bản upstream, kết thúc bằng đúng 1 `data: [DONE]`.',
        blocks: [
          {
            kind: 'table',
            headers: ['Field', 'Type', 'Bắt buộc', 'Ghi chú'],
            rows: [
              ['`messages`', '`Array<{role, content}>`', '✅', 'role: `system`/`user`/`assistant`, content string; message sai shape bị drop; rỗng hết → 400. Có `conversation_id` → history được prepend'],
              ['`stream`', '`boolean`', '✅ `true`', 'MVP chỉ hỗ trợ SSE pass-through — khác → 400'],
              ['`model`', '`string`', '—', 'mặc định `glm-5.3`'],
              ['`conversation_id`', '`string`', '—', 'bật bộ nhớ hội thoại (user messages được lưu, prepend lần sau)'],
              ['`thinking`', '`{type: "enabled"|"disabled"}`', '—', 'mặc định `enabled`'],
              ['`clear_thinking`', '`boolean`', '—', 'mặc định `true`'],
              ['`max_tokens`', '`int > 0`', '—', '—'],
              ['`temperature`', '`0–2`', '—', '—'],
            ],
          },
          {
            kind: 'code',
            lang: 'bash',
            title: 'Request (curl)',
            code: `curl -N -X POST '{HUB}/v1/chat/completions?XTransformPort=3003' \\
  -H 'Authorization: Bearer zhb_dev_default_key' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "model": "glm-5.3",
    "messages": [{"role": "user", "content": "Xin chào"}],
    "stream": true,
    "conversation_id": "demo-1"
  }'`,
          },
          {
            kind: 'code',
            lang: 'text',
            title: 'Response 200 — wire format SSE (headers + thứ tự điển hình)',
            code: `Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
X-Job-Id: <uuid>            ← trace / đối chiếu hub log
X-Request-Id: <uuid>

data: {"choices":[{"delta":{"reasoning_content":"..."}}], ...}   ← thinking (nếu upstream có)
data: {"choices":[{"delta":{"content":"..."}}], ...}             ← answer chunks
data: {"choices":[{"delta":{},"finish_reason":"stop"}], "usage": {...}, ...}  ← chunk cuối
data: [DONE]                                                     ← kết thúc (đúng 1 dòng)`,
          },
          {
            kind: 'code',
            lang: 'js',
            title: 'Client JavaScript — đọc stream bằng fetch + ReadableStream',
            code: `const HUB = 'https://<hub-host>'; // hoặc window.location.origin nếu client cùng host hub
const KEY = 'zhb_dev_default_key';

const res = await fetch(\`\${HUB}/v1/chat/completions?XTransformPort=3003\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${KEY}\`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'glm-5.3',
    messages: [{ role: 'user', content: 'Xin chào' }],
    stream: true,
    conversation_id: 'demo-1',
  }),
});

if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
let answer = '';

for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split('\\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.startsWith('event: error')) {
      console.error('stream error frame:', line);
      continue;
    }
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') continue; // kết thúc sạch
    const chunk = JSON.parse(payload);
    const delta = chunk.choices?.[0]?.delta ?? {};
    if (delta.reasoning_content) console.debug('thinking:', delta.reasoning_content);
    if (delta.content) answer += delta.content;
  }
}
console.log('answer:', answer);`,
          },
          {
            kind: 'code',
            lang: 'python',
            title: 'Client Python — requests + iter_lines',
            code: `import json
import requests

HUB = "https://<hub-host>"          # public URL sandbox hub
KEY = "zhb_dev_default_key"

with requests.post(
    f"{HUB}/v1/chat/completions",
    params={"XTransformPort": 3003},  # gateway sandbox forward tới hub :3003
    headers={"Authorization": f"Bearer {KEY}"},
    json={
        "model": "glm-5.3",
        "stream": True,
        "messages": [{"role": "user", "content": "Xin chào"}],
    },
    stream=True,
    timeout=120,
) as r:
    r.raise_for_status()
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        payload = line[6:]
        if payload == "[DONE]":
            break
        delta = json.loads(payload)["choices"][0]["delta"]
        print(delta.get("content", ""), end="", flush=True)`,
          },
          {
            kind: 'table',
            headers: ['HTTP', 'Lỗi JSON trước khi stream'],
            rows: [
              ['**400**', 'body không phải JSON; sai schema (`messages` rỗng/sai shape, `max_tokens` <= 0, `temperature` ngoài 0–2…); `stream` khác `true`; job payload fail schema'],
              ['**401**', 'thiếu/sai `Authorization: Bearer <key>` → `{"error":{"message":"invalid api key"}}`'],
            ],
          },
          {
            kind: 'code',
            lang: 'text',
            title: 'Lỗi TRONG stream (sau 200 — worker chết giữa stream…)',
            code: `event: error
data: {"error":{"message":"upstream connection lost (worker died midstream)","type":"upstream_error"}}

data: [DONE]`,
          },
          {
            kind: 'list',
            items: [
              '`type` của frame lỗi ∈ `upstream_error | cancelled | timeout | quota | unknown`.',
              'Dispatch least-loaded: job đi worker có `inflight` thấp nhất (tie → worker đăng ký trước).',
              'Job CHƯA có chunk đầu → re-dispatch tối đa **1** lần (worker chết / ack-timeout 30s).',
              'ĐÃ có chunk đầu → **at-most-once**, không re-dispatch; client disconnect → hub gửi `job.cancel`.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'workers',
    title: 'GET /internal/workers',
    blurb: 'Snapshot registry + stats của worker pool — nguồn dữ liệu tab Workers / Stats của Hub UI.',
    endpoints: [
      {
        id: 'workers-endpoint',
        method: 'GET',
        path: '/internal/workers',
        summary: 'Read-only. Header `X-Worker-Secret` bắt buộc (khớp env `WORKER_SECRET` của hub) — sai/thiếu → 401.',
        blocks: [
          {
            kind: 'code',
            lang: 'bash',
            title: 'Request',
            code: `curl -s '{HUB}/internal/workers?XTransformPort=3003' \\
  -H 'X-Worker-Secret: <WORKER_SECRET>'`,
          },
          {
            kind: 'code',
            lang: 'json',
            title: 'Response 200',
            code: `{
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
        "worker_id": "w2-…",
        "tenant_id": "default",
        "models": ["glm-5.3"],
        "concurrency": 2,
        "protocol_version": 1
      }
    }
  ],
  "uptime_seconds": 76,
  "total_jobs_all_time": 2
}`,
          },
          {
            kind: 'table',
            headers: ['Field', 'Ý nghĩa'],
            rows: [
              ['`workers[].id`', 'worker_id (`worker_id` giữ lại cho tiện debug — cùng giá trị)'],
              ['`workers[].status`', '`online` (đang trong registry) / `offline` (mất kết nối ≤ 15 phút, quá TTL rơi khỏi danh sách)'],
              ['`connected_at`', 'epoch ms — mốc connection hiện tại (re-register cập nhật mới)'],
              ['`last_heartbeat`', 'epoch ms — authoritative từ registry khi online'],
              ['`inflight`', 'số slot đang dùng (cap = `capabilities.concurrency`)'],
              ['`total_jobs`', 'số job DUY NHẤT worker đã nhận (đếm theo `job.ack`, dedupe toàn hub)'],
              ['`total_jobs_all_time`', 'tổng job duy nhất đã tới tay mọi worker'],
              ['`uptime_seconds`', 'uptime tiến trình hub'],
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'worker-token',
    title: 'GET /internal/worker-token',
    blurb: 'Worker gọi endpoint này ĐẦU TIÊN (kèm `X-Worker-Secret`) để lấy HMAC token TTL ngắn, rồi dùng trong frame `worker.register` đầu tiên trên WS.',
    endpoints: [
      {
        id: 'worker-token-endpoint',
        method: 'GET',
        path: '/internal/worker-token',
        summary: 'Mint token cho worker WS — sai/thiếu `X-Worker-Secret` → 401.',
        blocks: [
          {
            kind: 'table',
            headers: ['Query', 'Mặc định', 'Ghi chú'],
            rows: [
              ['`tenant_id`', '`default`', 'phải khớp `capabilities.tenant_id` lúc register'],
              ['`ttl`', '`60`', 'giây, kẹp trong `[5, 300]`'],
            ],
          },
          {
            kind: 'code',
            lang: 'bash',
            title: 'Request + Response 200',
            code: `curl -s '{HUB}/internal/worker-token?XTransformPort=3003' \\
  -H 'X-Worker-Secret: <WORKER_SECRET>'

{ "token": "<payload>.<sig>", "tenant_id": "default", "ttl_seconds": 60, "expires_at": 1794558972000 }`,
          },
          {
            kind: 'note',
            tone: 'info',
            text: 'Trên Hub UI (tab Workers) có sẵn box **Worker Connection Info** sinh đúng URL này từ HUB PUBLIC BASE URL — copy rồi paste vào form setup của worker sandbox mới.',
          },
        ],
      },
    ],
  },
  {
    id: 'ws',
    title: 'WS /worker — worker protocol',
    blurb: 'Worker TỰ connect outbound tới `wss://<hub-host>/worker?XTransformPort=3003` — hub không bao giờ inbound vào sandbox worker.',
    blocks: [
      {
        kind: 'list',
        items: [
          'Frame ĐẦU TIÊN phải là `worker.register` hợp lệ (token + tenant + protocol_version khớp) — sai bất cứ điều nào → close **4401**.',
          'Duplicate worker_id (2 connection cùng ID) → connection cũ bị thay, close **4409**.',
          'Heartbeat > **45s** → sweep coi worker chết (sweep mỗi 10s); `job.ack` phải tới trong **30s** sau dispatch (visibility timeout).',
          'Control frames = JSON TEXT; job chunk = BINARY envelope F4: `[16B job_id][4B seq BE][raw SSE bytes nguyên xi]` (header 20 bytes).',
        ],
      },
      {
        kind: 'table',
        headers: ['Chiều', 'Frame', 'Ghi chú'],
        rows: [
          ['W → H', '`worker.register {type, capabilities, token}`', 'capabilities: `{worker_id, tenant_id, models[], concurrency, protocol_version}`'],
          ['W → H', '`worker.heartbeat {type, ts, inflight}`', '`inflight` authoritative'],
          ['W → H', '`job.ack {type, job_id}`', 'trong 30s sau dispatch'],
          ['W → H', 'binary `job.chunk`', 'envelope F4 — raw SSE bytes relay nguyên xi'],
          ['W → H', '`job.done {type, job_id, finish_reason, usage?, upstream_done_relayed?}`', '`upstream_done_relayed:true` → hub không flush thêm `[DONE]`'],
          ['W → H', '`job.error {type, job_id, error:{message, type}}`', 'trước chunk đầu → requeue (max 1); sau chunk → `event:error` + `[DONE]` cho client'],
          ['H → W', '`job.dispatch {type, job}`', 'job = JobPayload đầy đủ'],
          ['H → W', '`job.cancel {type, job_id, reason?}`', 'user disconnect / hub cancel'],
          ['H → W', '`hub.ping {type, ts}`', 'keepalive'],
        ],
      },
      {
        kind: 'p',
        text: 'Chi tiết đầy đủ của wire contract: `packages/protocol/src/frames.ts` (zod — 2 đầu validate) và `docs/api.md`.',
      },
    ],
  },
  {
    id: 'errors',
    title: 'Bảng mã lỗi tổng hợp',
    blocks: [
      {
        kind: 'table',
        headers: ['HTTP / mã', 'Endpoint', 'Nguyên nhân'],
        rows: [
          ['**400**', '`/v1/chat/completions`', 'body/schema/stream/messages/payload không hợp lệ'],
          ['**401**', '`/v1/chat/completions`', 'sai/thiếu Bearer key'],
          ['**401**', '`/internal/worker-token`, `/internal/workers`', 'thiếu/sai `X-Worker-Secret`'],
          ['**404**', 'bất kỳ', 'path không tồn tại (`{"error":{"message":"not found"}}`)'],
          ['WS **4401**', '`/worker`', 'frame đầu không phải register hợp lệ / token hết hạn / tenant sai / protocol_version sai'],
          ['WS **4409**', '`/worker`', 'duplicate worker_id (connection cũ bị thay)'],
          ['SSE `event: error`', '`/v1/chat/completions`', 'lỗi sau khi stream bắt đầu — luôn kèm `data: [DONE]` kết thúc sạch'],
        ],
      },
    ],
  },
  {
    id: 'deployment',
    title: 'Deploy console & hub ở đâu?',
    blurb: 'Trả lời câu hỏi thường gặp: chạy được trên GitHub Pages không? — Site docs NÀY chạy được, hub/console thì không.',
    blocks: [
      {
        kind: 'table',
        headers: ['Thành phần', 'GitHub Pages?', 'Nơi chạy phù hợp'],
        rows: [
          ['**Site docs static** (chính trang này, export bằng `bun run export:docs`)', '✅ CÓ', 'GitHub Pages / bất kỳ static host nào'],
          ['**Hub (webhub :3003)**', '❌ KHÔNG', 'Cần Node runtime + WebSocket + HMAC token + secret → VPS chính / Fly.io / Railway / container nào đó có port công khai'],
          ['**Console (Next.js :3000)**', '❌ KHÔNG (full)', 'Cần server-side routes giữ secret (`/api/workers`, `/api/worker-secret`) → Vercel (set env `WORKER_SECRET`, `HUB_INTERNAL_URL`) hoặc chạy cùng VPS với hub'],
          ['**Worker (apps/worker)**', '❌ KHÔNG', 'Sandbox ephemeral Z.AI — tự connect outbound ra hub, không cần inbound'],
        ],
      },
      {
        kind: 'list',
        items: [
          'Deploy docs lên GitHub Pages (CI tự chạy khi `api-docs.ts` đổi): workflow `deploy-docs.yml` build artifact từ `apps/dev-console/docs-site/` rồi deploy qua `actions/deploy-pages` — nội dung workflow lưu sẵn tại `docs/deploy/github-pages-workflow.yml` (tạo file qua GitHub web UI nếu PAT thiếu scope workflow).',
          'Deploy THỦ CÔNG: chạy `bun apps/dev-console/scripts/export-docs-site.ts` → push `apps/dev-console/docs-site/` lên branch `gh-pages` → Settings → Pages → Source: *Deploy from a branch* → chọn `gh-pages / root`.',
          'Repo GitHub Pages cần bật trong Settings → Pages trước khi workflow deploy chạy được lần đầu.',
          'Chi tiết đầy đủ: `docs/deploy/40-github-pages.md`.',
        ],
      },
      {
        kind: 'note',
        tone: 'info',
        text: 'Tại sao hub không chạy được trên GitHub Pages: Pages chỉ serve file TĨNH — không có tiến trình Node, không WebSocket server, không biến env secret, không mint token. Hub là tiến trình Node Hono sống bằng WS persistent connections.',
      },
    ],
  },
];
