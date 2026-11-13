import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // 4.0-W (fix port env): src/instrumentation.ts đăng ký service supervisor (tự spawn lại hub
  // :3003 / worker :3005 khi không phản hồi, GHÌ PORT riêng) — phải qua server restart.
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Cho phép dev resource (HMR websocket, font dev) từ các host truy cập console:
  // - 127.0.0.1 / localhost: truy cập trực tiếp trong sandbox (agent-browser, curl).
  // - *.space-z.ai: public URL preview của sandbox (owner mở qua gateway — Host giữ nguyên domain).
  // Không có mục này, Next 16 chặn /_next/hmr + font dev → hydration stall → TRẮNG TRANG trên host lạ.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.space-z.ai"],
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
