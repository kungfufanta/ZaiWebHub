# 70 — Pipeline PROD của sandbox platform (4.4-Q)

> Cách platform build + deploy project này lên PROD (URL `-d.space-z.ai`), và những gì
> code PHẢI tuân thủ để không chết trên prod. Ghi sau khi đọc trọn bộ `.zscripts/`
> của platform (build.sh, start.sh, dev.sh, mini-services-*.sh, database-runtime-build.sh).

## 1. Pipeline platform làm gì (đọc từ script gốc)

### BUILD (chạy TRONG sandbox, tại `/home/z/my-project`) — `.zscripts/build.sh`

1. `bun install` (root).
2. `bun run build` → **guard bắt buộc**: `.next/standalone/server.js` phải tồn tại
   (chính vì thế `next.config.ts` phải giữ `output: "standalone"` — script có đoạn
   tự-heal注入 nhưng fail cứng nếu config khai khác).
3. Mini-services: `bun install` từng service → **bundle thành 1 file JS**:
   `mini-services/hub/index.ts` → `mini-services-dist/mini-service-hub.js`
   (`bun build --target bun --minify`). Worker tương tự (`mini-service-worker.js`).
   Source `mini-services/` KHÔNG theo artifact — chỉ bundle.
4. `database-runtime-build.sh`: copy `db/custom.db` + `db:push` vào artifact
   (không có db → init db rỗng).
5. Copy `Caddyfile`, `start.sh` → tar.gz deploy đi.

### DEPLOY (chạy trong container FC, tại `/app`) — `.zscripts/start.sh`

```
/app/
  next-service-dist/   (standalone: server.js + .next/ + node_modules traced)
  mini-services-dist/  (mini-service-hub.js, mini-service-worker.js, mini-services-start.sh)
  db/custom.db · Caddyfile · start.sh
```

- Next: `cd next-service-dist && NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
  bun server.js &` — **`PORT=3000` được export cho TOÀN container** (mọi process con
  kế thừa, kể cả mini-services).
- Mini-services: `mini-services-start.sh` chạy MỘT LẦN mỗi file
  `mini-service-*.js` — **chết là không ai restart**.
- Caddy `:81` là foreground process chính (gateway `?XTransformPort=` giữ nguyên hành vi).
- Health check FC 120s — probe qua Caddy → :3000. Next chưa lên = deploy "Failed".

## 2. Những cái đã giết deploy (4.4-D + 4.4-Q)

| # | Cơ chế chết | Fix |
|---|---|---|
| 1 | `next/font/google` fetch Google Fonts lúc BUILD; runner chặn internet → `next build` fail → không server nào start | 4.4-D: bỏ next/font, font hệ thống trong `globals.css` |
| 2 | Runner probe `/api/health` (rewrite sang worker) lúc worker chưa sống → 500 → deploy FAILED | 4.4-D: `/api/health` + `/healthz` là route của console, rewrite chỉ khi có `?XTransformPort` |
| 3 | Hub bundle đọc `process.env.PORT` — platform export `PORT=3000` → hub listen TRÙNG Next → EADDRINUSE → hub chết ngay boot | 4.4-Q: hub CHỈ đọc `HUB_INTERNAL_PORT` (mặc định 3003) |
| 4 | Secret/API-key lệch nguồn: console standalone (cwd=`next-service-dist`) ghi `.runtime/` cạnh server.js; hub/worker bundle (`import.meta.dir=/app/mini-services-dist`) walk-up cũ đọc `/.runtime/` → worker không bao giờ đăng ký được, xoay secret không lan truyền | 4.4-Q: `runtime-paths.ts` (3 bản đồng bộ) — mọi process converge về ROOT DEPLOY (marker `mini-services-dist`/`start.sh`), `.runtime` chung 1 chỗ |
| 5 | File-tracer của Next copy cả `mini-services/hub/index.ts` + `src/lib` vào `next-service-dist` (do join path literal) → walk-up nhầm `next-service-dist` là repo root | 4.4-Qa: luật loại bỏ candidate có `server.js` + `.next` cùng cấp (standalone dist không bao giờ là root) |
| 6 | Bundle chết sau boot thì không ai restart (platform chỉ chạy 1 lần) | 4.4-Q: supervisor nhận diện cả layout bundle → spawn lại `mini-services-dist/mini-service-*.js` + neo env file-runtime tường minh |

## 3. Quy ước code trên prod (bắt buộc nhớ khi viết thêm)

- **PORT của hub**: chỉ `HUB_INTERNAL_PORT`. KHÔNG BAO GIỜ đọc `PORT` trong
  mini-services (platform export PORT=3000 cho Next).
- **File runtime** (`.runtime/*`, `worker-config.json`): resolve QUA
  `runtime-paths.ts` — không tự walk-up `import.meta.dir` thủ công nữa.
  Env override: `WEBHUB_ROOT`, `WEBHUB_RUNTIME_DIR`, `WORKER_SECRET_FILE`,
  `API_KEYS_FILE`, `WORKER_CONFIG_FILE`.
- **Next standalone**: `next-service-dist` bị tracer copy kèm `mini-services/` +
  `src/lib/` — đây là file CHẾT (không chạy), đừng read/add code dựa vào nó.
- **Supervisor** (src/lib/hub-supervisor.ts): layout repo → spawn source
  `bun index.ts`; layout bundle (FC) → spawn `bun mini-services-dist/mini-service-*.js`.
  Tắt: `HUB_AUTO_SPAWN=0` / `WORKER_AUTO_SPAWN=0`.
- **z-ai-web-dev-sdk (worker proxy mode)**: đọc config `cwd → home → /etc/.z-ai-config`.
  Container FC deploy KHÔNG có `/etc/.z-ai-config` của sandbox → worker local trên prod
  sẽ báo lỗi upstream khi nhận job. Kiến trúc đúng trên prod: worker node chạy ở sandbox
  khác, connect vào hub qua URL công cộng (`wss://<hub-host>/worker?XTransformPort=3003`).

## 4. Checklist trước khi bấm Deploy

1. `bun run lint` sạch; `tsc -p mini-services/hub` + `tsc -p mini-services/worker` 0 lỗi.
2. Không dùng `next/font/google` hay bất kỳ network call nào lúc BUILD.
3. `/api/health`, `/healthz` trả 200 không phụ thuộc service ngoài.
4. Đổi code mini-services phải test qua mô phỏng bundle:
   `bun build index.ts --target bun --minify` rồi chạy file bundle đó.
5. Fresh deploy: worker node hiện "stopped" là by-design (chưa có secret) —
   setup qua tab Worker node / Workers trên UI sau khi lên sóng.

## 5. 4.4-R — GỐC LỖI deploy Failed cuối cùng: `.zscripts` bị mất sau re-provision

### Cơ chế Deploy thật (đọc từ control service `POST /deploy`)

Bấm Deploy trên UI → control service của sandbox (root, uvicorn `:12600`) nhận
`POST /deploy {"userid", "chatid"}` → chạy **`bash /home/z/my-project/.zscripts/build.sh`**
→ tar.gz artifact (`/tmp/build_fullstack_$BUILD_ID.tar.gz`) → nạp lên FC instance mới
→ FC boot bằng `start.sh` (deploy variant, mục 1) → health check :81 trong 120s.

### Chuỗi chết

1. `.zscripts/` là runtime platform-managed — chỉ có trong image sandbox ban đầu,
   **KHÔNG có trong git** (bị .gitignore cũ loại).
2. Sandbox dừng → prestop ghi `/home/sync/repo.tar` = **chỉ chứa git-tracked files**
   (792 entries: `.git/` + source; KHÔNG có `.zscripts`, node_modules, .next, db).
3. Sandbox re-provision → `/start.sh` restore từ repo.tar → `.zscripts` MẤT VĨNH VIỄN
   (cùng số phận: `.env.local`, `.runtime/`, db data — db được `db:push` tạo lại rỗng).
4. Deploy sau đó → `bash .zscripts/build.sh: No such file or directory` → Deploy **Failed**
   (trang lỗi platform: "Sorry, there was a problem deploying the code").

### Fix (4.4-R)

- Commit `.zscripts/*.sh` VÀO REPO (8 script deploy tooling — không có secret).
  `.gitignore` chỉ loại runtime junk sinh ra trong đó (`dev.pid`, `*.log`).
- Tự-heal: mọi lần reboot, `/start.sh` restore repo.tar → `.zscripts` sống lại →
  deploy luôn tìm thấy `build.sh`.

### Bài học chẩn đoán

- Code/bundle/standalone/health-check đều sạch (verify bằng mô phỏng đầy đủ:
  build trong /tmp copy, chạy thật `.zscripts/start.sh` + Caddy :81 → 200) —
  lỗi nằm ở PLATFORM PIPELINE, không phải app. Nếu deploy Failed không rõ
  nguyên nhân: `POST http://127.0.0.1:12600/deploy` với userid/chatid từ IM
  gateway metadata → response JSON trả `error` + `logs` CHÍNH XÁC bước chết.
- Sau re-provision phải kiểm tra lại: `.env.local` (WORKER_SECRET), `.runtime/`,
  `.zscripts/` — 3 thứ không theo repo.tar.

### 4.4-Rb — giới hạn của POST /deploy cục bộ (quan trọng)

Sau khi build xong (artifact 23MB ở `/tmp/build_fullstack_$BUILD_ID.tar.gz`,
chỉ ~17s nhờ Turbopack cache), handler gọi tiếp cloud API của platform để upload
+ tạo FC instance. Bước này **từ chối mọi identity tự chế** (userid/chatid chỉ
được truyền qua, không validate cục bộ — test với chatid rác vẫn chạy đủ build
rồi 500 như nhau) → `Internal Server Error` không có traceback đọc được
(`/app` root-only 700, uvicorn log ra pts/0).

Hệ quả: **không thể tự deploy từ trong sandbox**. Deploy thật PHẢI bấm từ nút
Deploy trên UI platform (auth context thật). Vai trò của POST cục bộ: công cụ
chẩn đoán — phản hồi `error`/`logs` của nó lộ chính xác bước build chết.

Dấu hiệu phân biệt lúc debug deploy Failed:
- Lỗi build (thấy qua POST cục bộ, trả JSON) → sửa code/`.zscripts`.
- `Internal Server Error` SAU khi `/tmp/build_fullstack_*.tar.gz` đã đủ → đã
  qua hết phần build, chết ở cloud — dùng UI Deploy, không dùng POST cục bộ.

## 6. 4.4-S — SLIM ARTIFACT: 23MB → 12MB (15/11, sau re-provision 05:31)

### Bằng chứng chẩn đoán (toàn bộ verify được từ trong sandbox)

1. `build.sh` OK cả 2 lần chạy (05:32 user deploy + 05:37 POST chẩn đoán) —
   tarball đủ thành phần → **build không phải vấn đề**.
2. Mô phỏng FC đầy đủ: giải nén tarball → `server.js` + 2 bundle:
   Next ready 71–103ms, `/` 200, `/api/health` 200, hub/worker health 200 →
   **artifact cũ vẫn boot tốt, health check phải pass**.
3. POST /deploy cục bộ (chatid thật từ IM metadata + userid tự chế): build ~17s
   xong → 500 plain-text tại cloud API — đúng 4.4-Rb.
4. Domain `-d` trả 500 static ở MỌI path → chưa từng có FC instance nào sống.

→ Kết luận: chết ở bước cloud (upload/tạo FC). Hai nghi vấn không đọc được từ
sandbox (`/app` root-only): cloud từ chối artifact (size?) hoặc credential
cloud của sandbox chết sau re-provision.

### Fix trong tầm tay — loại node_modules chết khỏi standalone

Traced node_modules 72MB gồm: `@img` (sharp) 33MB với CẢ 4 biến thể platform,
`typescript` 20MB (tsc không chạy runtime), next 18MB (cần). Fix:
`next.config.ts` `outputFileTracingExcludes` — typescript, sharp musl variants
(FC debian glibc), skills/mini-services/src/dev.log (file chết do string literal
trong supervisor). Kết quả: **node_modules traced 72→36MB, tarball 23→12MB
(-48%)**, rebuild theo đúng `build.sh` + sim lại 4/4 endpoint 200.

Ghi chú kỹ thuật:
- `src/` `skills/` `mini-services/` `dev.log` (~1.3MB) vẫn còn trong standalone:
  Turbopack thêm chúng như static file refs (string literal path trong
  hub-supervisor, vd `'dev.log'` cho log path) miễn nhiễm excludes — vô hại,
  không đuổi theo.
- Standalone thiếu `.prisma`/`@prisma` là ĐÚNG: console không import `@/lib/db`
  lúc runtime (chỉ `src/lib/db.ts` tự định nghĩa, không route nào dùng) → đừng
  thêm outputFileTracingIncludes cho prisma (17.5MB query engine).
- Worker bundle đọc `WORKER_PORT` (không phải `WORKER_SERVICE_PORT` — env đó là
  của supervisor/console).

### Việc còn lại

Bấm Deploy trên UI với artifact 12MB. Nếu VẪN failed → mọi thứ trong sandbox
đã xanh (build + artifact + boot + health), lỗi nằm 100% ở cloud platform →
retry sau hoặc cần platform support.
