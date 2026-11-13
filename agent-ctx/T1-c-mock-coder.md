# Work record — T1-c-mock (coder agent)

Task: T1-c-mock (chủ dự án gọi là "T4-a mock") — build `apps/dev-console`: Next.js chat UI wired to a MOCK SSE endpoint, no real adapter/hub yet.

Status: DONE (code complete, syntax-checked with Bun transpiler; no install/dev/lint run per constraints — orchestrator installs later).

## Scope compliance
- Files created/modified ONLY under `/home/z/zaiwebhub-analysis/apps/dev-console/**` + this work record in `/agent-ctx/` (mandated by orchestrator convention). `git status` confirmed: no changes to apps/webhub, apps/worker, packages/*, root configs.
- `/home/z/my-project` untouched (read-only reference).
- No bun/npm install, no dev server, no git commit/push.

## File list

### Copied verbatim from prototype (/home/z/my-project)
- Config: `postcss.config.mjs`, `components.json`, `tailwind.config.ts`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `src/app/globals.css`
- UI kit (ALL 48 components): `src/components/ui/*.tsx` (alert-dialog, badge, button, card, chart, collapsible, dialog, form, input, label, popover, select, sheet, switch, textarea, toast, toaster, ... — full shadcn set)
- Hooks: `src/hooks/use-toast.ts`, `src/hooks/use-mobile.ts`
- Chat components (verbatim): `event-log.tsx`, `markdown-lite.tsx`, `session-sidebar.tsx`, `stream-stats-bar.tsx`, `thinking-panel.tsx`
- Lib (verbatim): `src/lib/chat-types.ts`, `src/lib/chat-utils.ts`, `src/lib/utils.ts`

### New / adapted
- `package.json` — NEW: name `@zaiwebhub/dev-console`, private, workspace-compatible (root workspaces = packages/*, apps/*). Scripts: `dev: next dev -p 3000`, `build`, `start`, `lint`.
- `src/app/api/mock-chat/route.ts` — NEW: mock SSE emitter (core of the task, see contract below). `runtime='nodejs'`, `dynamic='force-dynamic'`, TextEncoder + ReadableStream pattern copied from prototype's `/api/chat/route.ts`. Abort via `req.signal` + stream `cancel()`: sets `closed`, stops emitting, closes cleanly, no errors logged.
- `src/lib/sse-client.ts` — ADAPTED: endpoint defaults to `/api/mock-chat`, overridable via `NEXT_PUBLIC_CHAT_ENDPOINT`; added `errorTest` option -> body `{ error_test: true }`. Parser/metrics-event logic untouched.
- `src/hooks/use-chat-sessions.ts` — ADAPTED: only STORAGE_KEY renamed to `zaiwebhub-dev-console.sessions.v1`.
- `src/components/chat/chat-tester.tsx` — ADAPTED: added `errorTest` to persisted settings (localStorage `zaiwebhub-dev-console.settings.v1`), passes `errorTest` to `streamChat` + Composer; desktop `<aside>` -> `<nav aria-label>`; localStorage keys namespaced.
- `src/components/chat/composer.tsx` — ADAPTED: added checkbox "Mock lỗi stream (error_test)" (radix Checkbox + Label, aria-label) + inline warning when active; sets error_test on the NEXT send.
- `src/components/chat/message-list.tsx` — ADAPTED: 2 Vietnamese text tweaks ("Đang kết nối tới mock endpoint...", empty-state heading describes MOCK stream + /api/mock-chat).
- `src/app/layout.tsx` — ADAPTED: metadata for ZaiWebHub dev-console, `lang="vi"`.
- `src/app/page.tsx` — NEW: app shell — root `min-h-screen flex flex-col`, header (title + MOCK badge + endpoint), `main` `flex-1 min-h-0` wrapping ChatTester, footer `mt-auto` with text `ZaiWebHub dev-console — MOCK mode`. Responsive (sidebar collapses to Sheet on <lg, via prototype's chat-tester).
- `.gitignore` — NEW (node_modules/.next/logs; root .gitignore already covers most).

## package.json dependencies declared
Runtime deps (versions mirrored from prototype): all 23 `@radix-ui/react-*` used by the copied UI kit (accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toast, toggle, toggle-group, tooltip), `class-variance-authority`, `clsx`, `cmdk`, `embla-carousel-react`, `input-otp`, `lucide-react`, `next ^16.1.1`, `next-themes`, `react ^19.0.0`, `react-day-picker`, `react-dom ^19.0.0`, `react-hook-form`, `react-markdown ^10.1.0`, `react-resizable-panels`, `recharts`, `sonner`, `tailwind-merge`, `tailwindcss-animate`, `vaul`.
DevDeps: `@tailwindcss/postcss ^4`, `@types/node ^22`, `@types/react ^19`, `@types/react-dom ^19`, `eslint ^9`, `eslint-config-next ^16.1.1`, `tailwindcss ^4`, `tw-animate-css ^1.3.5`, `typescript ^5`.
Deliberately NOT included (nothing imports them): z-ai-web-dev-sdk, prisma/@prisma/client, next-auth, next-intl, zustand, @tanstack/*, @dnd-kit/*, @mdxeditor/editor, framer-motion, zod, uuid, sharp, @reactuses/core, react-syntax-highlighter, bun-types (added @types/node instead for `process.env` typing).

## Mock stream vs contract table (packages/protocol/PLAN.md) — EXACT sequence emitted by POST /api/mock-chat
Body: `{ messages: [{role, content}], model?, thinking?, error_test? }`.
Normal (thinking on — default):
1. `event: thinking_start\ndata: {"message":"Thinking..."}\n\n`
2. `event: thinking_delta\ndata: {"delta":"..."}\n\n` — ~100 chunks (2 Vietnamese words each), 60-120ms apart, multi-paragraph fake reasoning quoting the user's last message, total ~7-9s
3. `event: answer_start\ndata: {"message":"Answer:"}\n\n` (exact "Answer:" per contract — prototype used "Answer", corrected to contract)
4. `data: {"choices":[{"delta":{"content":"..."},"index":0,"finish_reason":null}]}\n\n` — ~80 chunks, 40-80ms apart, Vietnamese markdown noting MOCK + quoting/summarizing user's last message, total ~5s
5. `event: finish\ndata: {"reason":"stop"}\n\n`
6. `data: [DONE]\n\n`, then stream closes
error_test=true:
`thinking_start` → 2×`thinking_delta` → `event: error\ndata: {"error":{"message":"Mock upstream failure (test)","type":"upstream_error"}}\n\n` → `data: [DONE]\n\n`, closed cleanly (no finish, no answer).
Also: 15s SSE comment heartbeat (`: keep-alive`), 400 JSON error on invalid messages, AbortController stop = no more chunks, clean close, nothing in logs.

## Notes for orchestrator
- Install at repo root (bun workspaces): `bun install` (my package.json joins apps/* workspace), then run: `cd apps/dev-console && npx next dev -p 3100` (or `bun run dev` which uses `-p 3000` per apps/dev-console/PLAN.md sandbox rule). Only app the browser touches; all fetches are relative.
- T4-a swap point: set `NEXT_PUBLIC_CHAT_ENDPOINT=/v1/chat/completions?XTransformPort=3003` — no code change needed.
- Lint with `cd apps/dev-console && npx eslint .` (eslint.config.mjs copied from prototype; dev-console isn't in root typecheck script yet).

## Deviations (honest)
1. Content-Type header is `text/event-stream; charset=utf-8` (prototype pattern; Vietnamese UTF-8 payload) — still matches `text/event-stream` prefix checks; strict equality checks would see the charset.
2. Spec only defines error_test with thinking on; I added the mirror path for thinking OFF (error after 2 answer_delta instead). With default settings the spec sequence is untouched.
3. Copied ALL 48 ui components per instruction, so package.json carries their radix/third-party deps (chart -> recharts, calendar -> react-day-picker, drawer -> vaul, command -> cmdk, form -> react-hook-form, sonner -> sonner+next-themes, ...). Unused deps are inert.
4. `@types/node ^22` added (not in prototype) so `process.env.NEXT_PUBLIC_CHAT_ENDPOINT` typechecks without bun-types.
5. `tailwind.config.ts` copied for parity (Tailwind v4 actually runs config-less via globals.css `@theme`); harmless, requires `tailwindcss-animate` dep which is declared.
6. Prototype page used `h-dvh overflow-hidden` app-shell; task required sticky-footer pattern (`min-h-screen flex flex-col` + `main flex-1` + `footer mt-auto`) — implemented as required; chat column still scrolls internally (min-h-0 chain preserved), footer never floats.
7. No typecheck/lint actually executed (deps not installed — constraint). Mitigation: all 70 files parse clean through Bun's TS/TSX transpiler; code is verbatim from a working prototype wherever possible.
