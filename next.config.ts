import type { NextConfig } from "next";

// Domain deploy prod khác *.space-z.ai (env CSV, hỗ trợ wildcard *.example.com) — merged vào
// allowedDevOrigins bên dưới. Không có mục này cho host lạ: Next 16 chặn /_next/hmr + font dev
// → hydration stall → TRẮNG TRANG khi mở console qua domain mới (lỗi deploy prod đã gặp).
const EXTRA_DEV_ORIGINS = (process.env.NEXT_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // 4.0-W (fix port env): src/instrumentation.ts đăng ký service supervisor (tự spawn lại hub
  // :3003 / worker :3005 khi không phản hồi, GHÌ PORT riêng) — phải qua server restart.
  // 4.4-P: supervisor gate theo layout repo (không còn .zscripts) + root walk-up cho standalone.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 4.4-S — SLIM ARTIFACT DEPLOY: gói deploy FC bị phình 23MB (node_modules traced 72MB) vì
  // tracer over-include. Cắt toàn bộ phần KHÔNG dùng lúc runtime:
  //  - node_modules/typescript (20MB): tsc không chạy trong standalone prod.
  //  - @img/*-linuxmusl-x64 (~16MB): FC debian glibc x64 — chỉ cần variant glibc.
  //  - skills/ + mini-services/ + src/ + dev.log (~1.3MB): tracer copy nhầm do path literal
  //    trong hub-supervisor/runtime-paths — file CHẾT trong standalone (mini-services prod
  //    chạy từ mini-services-dist bundle, không phải source).
  // Không thêm outputFileTracingIncludes cho .prisma: console KHÔNG import @/lib/db lúc
  // runtime (chỉ src/lib/db.ts tự định nghĩa, không route nào dùng) → thiếu .prisma vô hại,
  // không thêm 17.5MB query engine vào gói.
  outputFileTracingExcludes: {
    "*": [
      "./node_modules/typescript/**",
      "./node_modules/@img/sharp-linuxmusl-x64/**",
      "./node_modules/@img/sharp-libvips-linuxmusl-x64/**",
      "./skills/**",
      "./mini-services/**",
      "./src/**",
      "./dev.log",
    ],
  },
  // Cho phép dev resource (HMR websocket, font dev) từ các host truy cập console:
  // - 127.0.0.1 / localhost: truy cập trực tiếp trong sandbox (agent-browser, curl).
  // - *.space-z.ai: public URL preview/deploy của sandbox (owner mở qua gateway — Host giữ nguyên domain).
  // - EXTRA_DEV_ORIGINS từ env NEXT_ALLOWED_DEV_ORIGINS: domain prod riêng của bạn.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.space-z.ai", ...EXTRA_DEV_ORIGINS],
  // WebHub mode: client fetch `/v1/chat/completions?XTransformPort=3003`.
  // - QUA GATEWAY sandbox: gateway thấy XTransformPort=3003 → forward thẳng hub (rewrite không chạy).
  // - TRỰC TIẾP (local/agent-browser, không qua gateway): rewrite proxy server-side sang hub :3003.
  // Worker node service (:3005) — tương tự cho 4 endpoint của dashboard worker.
  // 4.4-D: rewrite CHỈ chạy khi URL có query XTransformPort (has-query, hành vi giống gateway).
  // Không có query → Next tự trả lời. Đặc biệt /api/health KHÔNG query giờ là self-health của
  // console (luôn 200): runner deploy probe health lúc worker chưa sống sẽ không còn 500 →
  // deploy không bị đánh dấu FAILED; probe worker thật vẫn đi /api/health?XTransformPort=3005.
  async rewrites() {
    const HUB = "http://127.0.0.1:3003";
    const WORKER = "http://127.0.0.1:3005";
    const viaGateway = (source: string, destination: string) => ({
      source,
      destination,
      has: [{ type: "query" as const, key: "XTransformPort" }],
    });
    // beforeFiles: rewrite phải chạy TRƯỚC filesystem route — nếu không, route handler
    // /api/health (console self-health) shadow mất rewrite khi có query XTransformPort.
    return {
      beforeFiles: [
        viaGateway("/v1/chat/completions", `${HUB}/v1/chat/completions`),
        viaGateway("/api/status", `${WORKER}/api/status`),
        viaGateway("/api/setup", `${WORKER}/api/setup`),
        viaGateway("/api/disconnect", `${WORKER}/api/disconnect`),
        viaGateway("/api/health", `${WORKER}/api/health`),
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
