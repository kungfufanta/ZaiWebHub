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
  // Cho phép dev resource (HMR websocket, font dev) từ các host truy cập console:
  // - 127.0.0.1 / localhost: truy cập trực tiếp trong sandbox (agent-browser, curl).
  // - *.space-z.ai: public URL preview/deploy của sandbox (owner mở qua gateway — Host giữ nguyên domain).
  // - EXTRA_DEV_ORIGINS từ env NEXT_ALLOWED_DEV_ORIGINS: domain prod riêng của bạn.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.space-z.ai", ...EXTRA_DEV_ORIGINS],
  // WebHub mode: client fetch `/v1/chat/completions?XTransformPort=3003`.
  // - QUA GATEWAY sandbox: gateway thấy XTransformPort=3003 → forward thẳng hub (rewrite không chạy).
  // - TRỰC TIẾP (local/agent-browser, không qua gateway): rewrite proxy server-side sang hub :3003.
  // Worker node service (:3005) — tương tự cho 4 endpoint của dashboard worker.
  async rewrites() {
    const WORKER = "http://127.0.0.1:3005";
    return [
      {
        source: "/v1/chat/completions",
        destination: "http://127.0.0.1:3003/v1/chat/completions",
      },
      { source: "/api/status", destination: `${WORKER}/api/status` },
      { source: "/api/setup", destination: `${WORKER}/api/setup` },
      { source: "/api/disconnect", destination: `${WORKER}/api/disconnect` },
      { source: "/api/health", destination: `${WORKER}/api/health` },
    ];
  },
};

export default nextConfig;
