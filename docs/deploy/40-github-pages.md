# 40 — Deploy docs (và console/hub) — GitHub Pages chạy được gì? (Task 3.7-D)

> Câu hỏi owner: *"console có docs + API như OpenAI để bên ngoài connect vào; có đưa console và
> hub lên GitHub Pages chạy không?"*
> Trả lời ngắn: **Docs: CÓ** (site static). **Console/hub: KHÔNG** — cần server runtime.

## 1. Cái gì chạy được trên GitHub Pages, cái gì không

GitHub Pages **chỉ serve file tĩnh** — không có tiến trình Node, không WebSocket server, không
biến env secret, không mint token. Đối chiếu từng thành phần:

| Thành phần | GitHub Pages? | Lý do / nơi chạy đúng |
|---|---|---|
| **Site docs static** (`apps/dev-console/docs-site/index.html`) | ✅ CÓ | File tĩnh thuần — đây chính là site docs "API như OpenAI" cho bên ngoài đọc cách connect |
| **Hub (webhub :3003)** | ❌ KHÔNG | Node Hono + WS persistent (`/worker`), HMAC mint token, env `WORKER_SECRET` → chạy **VPS chính / Fly.io / Railway** |
| **Console (Next.js :3000)** | ❌ KHÔNG (full) | Cần server-side routes giữ secret (`/api/workers`, `/api/worker-secret` đọc env `WORKER_SECRET` — KHÔNG được xuống client) → chạy **Vercel** (set env) hoặc cùng VPS với hub |
| **Worker (apps/worker)** | ❌ KHÔNG | Tiến trình Next.js headless + WS outbound → sandbox ephemeral Z.AI / container, KHÔNG cần inbound |

> Lưu ý: phần chat của console (WebHub mode) fetch thẳng hub qua CORS — bản client-side chạy
> được ở đâu cũng được; nhưng tab Workers/Stats phụ thuộc proxy server-side giữ secret → console
> FULL luôn cần một backend (Vercel free tier là đủ cho console).

## 2. Site docs static — 2 cách deploy

Nguồn sự thật nội dung: `apps/dev-console/src/lib/api-docs.ts` (cùng dữ liệu với tab **Docs** trên
Hub UI). Export thành 1 file HTML duy nhất (inline CSS + JS, không dependency):

```bash
bun apps/dev-console/scripts/export-docs-site.ts   # hoặc: cd apps/dev-console && bun run export:docs
# → apps/dev-console/docs-site/index.html  (37-40 KB)
```

Xem thử local: `cd apps/dev-console/docs-site && python3 -m http.server 8080` → mở `:8080`.

### Cách A — CI tự deploy (khuyến nghị)

Workflow dùng file `.github/workflows/deploy-docs.yml` — nội dung chuẩn lưu sẵn tại
`docs/deploy/github-pages-workflow.yml` (bản REFERENCE COPY). Vì PAT push thiếu scope `workflow`,
tạo file workflow **1 lần qua GitHub web UI**:

1. GitHub repo → **Add file → Create file** → path: `.github/workflows/deploy-docs.yml`
2. Dán nội dung `docs/deploy/github-pages-workflow.yml` (bỏ các dòng chú thích đầu) → Commit
3. **Settings → Pages → Source: "GitHub Actions"** (bật 1 lần duy nhất)

Sau đó: mỗi lần `api-docs.ts` / export script / workflow đổi trên `main` → bun chạy export →
deploy artifact qua `actions/deploy-pages`. URL: `https://kungfufanta.github.io/ZaiWebHub/`.

### Cách B — deploy thủ công lên branch `gh-pages`

```bash
bun apps/dev-console/scripts/export-docs-site.ts

rm -rf /tmp/pages && mkdir -p /tmp/pages && cp apps/dev-console/docs-site/index.html /tmp/pages/
cd /tmp/pages
git init -b gh-pages && git add . && git commit -m "docs site (manual deploy)"
git remote add origin https://github.com/kungfufanta/ZaiWebHub.git
git push -f origin gh-pages
```

Rồi Settings → Pages → Source: **Deploy from a branch** → `gh-pages` / `(root)`.

## 3. Console + hub chạy ở đâu (khuyến nghị đợt sau)

| Thành phần | Nhà cung cấp | Env cần set |
|---|---|---|
| Hub | Fly.io / Railway / VPS hiện có | `WORKER_SECRET`, `TENANT_KEYS` (production), không còn `XTransformPort` — URL sạch `https://hub-domain/v1/...` |
| Console | Vercel (free tier) | `WORKER_SECRET` (= hub), `HUB_INTERNAL_URL=https://<hub-domain>`; `NEXT_PUBLIC_WEBHUB_URL` nếu muốn chat client-side đi thẳng hub |
| Docs | GitHub Pages | — (đã xong theo mục 2) |

- Console trên Vercel dùng chính các server-side routes hiện có (`/api/workers`,
  `/api/worker-secret`) — secret nằm trong env Vercel, KHÔNG bao giờ xuống client (giống hệt
  sandbox hiện tại).
- Worker sandbox Z.AI giữ nguyên cơ chế: tự connect outbound `wss://<hub-domain>/worker`.
- Sau khi hub có domain riêng, bỏ query `XTransformPort=3003` (đó là đặc sản gateway sandbox).

## 4. Bảo mật khi public docs

- Docs public là ĐÚNG MỤC TIÊU — bên ngoài đọc để connect. Nội dung đã kiểm tra:
  - key dev `zhb_dev_default_key` là key CÔNG KHAI theo thiết kế sandbox (T3-e MVP) — OK để hiện;
    production set `TENANT_KEYS` và không document key thật.
  - `WORKER_SECRET` chỉ xuất hiện dạng placeholder `<WORKER_SECRET>` — KHÔNG bao giờ giá trị thật
    (docs public + console + static site đều vậy).
- Hub không set `WORKER_SECRET` → `/internal/*` không gate → cấm expose công khai (regulation
  hiện hành trong docs/api.md §1).
