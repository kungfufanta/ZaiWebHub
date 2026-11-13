# 60 — Deploy bản 1-repo (hub + console + worker trong 1 dự án)

> Thay thế workflow đa-app của monorepo gốc. Bài toán gốc: deploy monorepo 3 Next.js app
> riêng lên sandbox prod → **trắng trang**. Bản này gom tất cả về cấu trúc mà sandbox
> Z.AI hỗ trợ chính thức → clone về là chạy, không trắng trang.

## Vì sao monorepo gốc trắng trang trên prod

1. Sandbox chỉ expose **port 3000** qua Caddy gateway. Các app dev-console (:3005) / worker
   UI (:3000 trên sandbox khác) không có route công cộng ổn định nếu không tuân theo
   `?XTransformPort=` — asset absolute path / HMR host sai → hydration stall → trắng trang.
2. Next 16 chặn dev resource từ host lạ nếu thiếu `allowedDevOrigins` (`.space-z.ai`).
3. User chỉ thấy 1 route `/` — UI nhiều trang (`/workers`, `/stats`, `/docs`) không truy cập
   được từ preview panel.

## Giải pháp của bản này

| Thành phần | Trước (monorepo) | Sau (1-repo) |
|---|---|---|
| Console UI | `apps/dev-console` — Next.js app riêng, port 3005, 4 route | Tab client-side trong main app :3000, route `/` duy nhất |
| Hub | `apps/webhub` — service tsx/Node riêng trong workspace | `mini-services/hub` :3003 — Bun mini-service độc lập (code giữ nguyên) |
| Worker runtime + UI | `apps/worker` — Next.js app riêng | `mini-services/worker` :3005 (runtime Bun) + tab `Worker node` trong main app |
| Packages dùng chung | `packages/*` workspace, cần compat-build | Vendored: `src/lib/protocol`, `src/lib/zai-adapter`, `mini-services/*/src/protocol` |

## Topology vận hành

- **1 sandbox (all-in-one)** — mặc định: main app :3000 + hub :3003 + worker :3005, worker
  connect về chính hub của sandbox qua public URL. Demo/dev đủ mọi thứ.
- **N sandbox (pool thật)** — mỗi sandbox worker chạy `mini-services/worker` + mở main app
  (tab Worker node) để setup trỏ về hub sandbox; console + hub chỉ chạy trên 1 sandbox chính.
  Protocol/auth giữ nguyên: worker fetch `/internal/worker-token` với header
  `X-Worker-Secret`, mở WS `wss://<hub-host>/?XTransformPort=3003` path `/worker`.

## Checklist deploy

1. `bun install` ở root + 2 mini-service.
2. Set env (xem `.env.example`): `WORKER_SECRET` giống nhau hub/console/worker nếu expose.
3. `bun run dev` (root) + `bun run dev` trong `mini-services/hub` + `mini-services/worker`.
4. Mở preview → tab Workers thấy worker `online` → tab Console mode WebHub chat được.
5. Nếu trắng trang: kiểm tra `allowedDevOrigins` trong `next.config.ts` và bảo đảm mọi fetch
   là RELATIVE URL + `?XTransformPort=` (không ghi port trực tiếp).
