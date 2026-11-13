# 50 — Worker bundle: CI/CD đóng gói ZIP cho client (Task 3.8-P)

> Owner yêu cầu: *"mỗi lần commit lên main là sẽ đi gom source worker và các phụ thuộc liên quan
> đóng lại thành zip để client tải về start lên sandbox"*.
> Pipeline này làm đúng điều đó — client (sandbox worker mới) tải 1 file ZIP về, boot được ngay
> KHÔNG cần clone repo.

## 1. Pipeline

```
commit lên main (đụng apps/worker/**, packages/**, package.json, bun.lock, runbook worker)
   → GitHub Actions: .github/workflows/pack-worker.yml
      → bun apps/worker/scripts/pack-worker-bundle.ts
         - thu thập: apps/worker/** + packages/protocol + packages/zai-adapter
                     + root (package.json, tsconfig.base.json, bun.lock, README.md)
                     + docs/deploy/20-worker-sandbox.md
         - sinh START-HERE.md + apps/worker/.env.example
         - SAFETY: loại node_modules/.next/log/.worker-config.json/.env*;
                   scan file text — thấy WORKER_SECRET=<giá trị thật> → ABORT
         - output: worker-bundle-<ver>-<gitsha>.zip + worker-bundle.zip + .sha256 + MANIFEST.txt
      → upload artifact (giữ 30 ngày, traceability)
      → publish Release rolling tag `worker-bundle` (--clobber, asset tên cố định)
```

## 2. Client tải bundle về (URL công khai, KHÔNG cần auth)

```
https://github.com/kungfufanta/ZaiWebHub/releases/download/worker-bundle/worker-bundle.zip
https://github.com/kungfufanta/ZaiWebHub/releases/download/worker-bundle/worker-bundle.zip.sha256
https://github.com/kungfufanta/ZaiWebHub/releases/download/worker-bundle/MANIFEST.txt
```

- `worker-bundle.zip` luôn là bản mới nhất từ `main` (release rolling, tag `worker-bundle`).
- Kiểm tra checksum: `sha256sum -c worker-bundle.zip.sha256`.
- Xem version/file list: `MANIFEST.txt` (dạng `worker-bundle-0.0.1-<gitsha>.zip`).
- Wget trong sandbox worker: `wget -O worker-bundle.zip '<URL trên>'` → `unzip worker-bundle.zip`.

## 3. Boot trong sandbox — tóm tắt (chi tiết: START-HERE.md trong zip)

```bash
unzip worker-bundle.zip && cd zaiwebhub-worker
bun install                                   # workspace install (180 packages, <1 phút)

# Lấy từ Hub UI (:3000 → tab Workers): HUB PUBLIC BASE URL + WORKER_SECRET
export HUB_URL='https://<hub-host>'
export WORKER_SECRET='<WORKER_SECRET>'
export WORKER_ID='w-<tên-sandbox>'            # duy nhất mỗi sandbox

cd apps/worker
( nohup node scripts/dev-strict.mjs > worker.log 2>&1 < /dev/null & )   # pattern bắt buộc

tail -f worker.log   # mong đợi: worker.register sent → hub UI tab Workers badge online
```

Hoặc boot UI setup (không env): mở `:3000` của sandbox worker → form setup → paste URL + secret.
Sự cố thường gặp: xem bảng trong runbook `docs/deploy/20-worker-sandbox.md` (kèm trong zip).

## 4. Đã verify (không phải tin suông)

| Check | Kết quả |
|---|---|
| Pack tại sandbox dev | `worker-bundle-0.0.1-<sha>.zip` 152 KB / 70 entries |
| Loại trừ sạch | không có node_modules/.next/log/.worker-config.json/.env (chỉ `.env.example` placeholder) |
| Extract + `bun install` | 180 packages OK |
| Boot headless từ bundle (port 3100, env) | `worker.register sent` → hub `/internal/workers` thấy `w-bundle-t1 online` |
| Kết thúc sạch | kill + cleanup OK |

## 5. Chạy tay (không đợi CI)

```bash
bun apps/worker/scripts/pack-worker-bundle.ts      # output: apps/worker/dist/
```

## 6. Bật CI — 1 lần qua GitHub web UI

Workflow dùng file `.github/workflows/pack-worker.yml` — PAT push thiếu scope `workflow` nên
không push được file này. Nội dung chuẩn lưu tại `docs/deploy/pack-worker-workflow.yml`:

1. GitHub repo → **Add file → Create file** → path: `.github/workflows/pack-worker.yml`
2. Dán nội dung `docs/deploy/pack-worker-workflow.yml` (bỏ các dòng chú thích đầu) → Commit
3. Xong — lần chạy đầu sẽ tự tạo Release `worker-bundle`.

> Có thể tạo cùng lúc với `.github/workflows/deploy-docs.yml` (xem 40-github-pages.md mục 2
> Cách A) — chung 1 lần Add file cho tiện.

## 7. An toàn secret

- Script ABORT nếu thấy giá trị `WORKER_SECRET` thật (≥24 ký tự, không phải placeholder `<…>`)
  trong bất kỳ file nào được staged — không có cơ chế nào đưa secret vào zip.
- `.worker-config.json` (chứa hub URL + secret của worker sandbox cũ) bị loại khỏi bundle.
- Bundle chỉ chứa SOURCE + placeholder; secret chỉ tồn tại khi client tự set env/qua UI setup.
