import type { NextConfig } from "next";

// Đợt 3.5: WEBHUB_ORIGIN (server-side) — khi console chạy sandbox KHÁC hub, rewrite
// proxy server-side sang hub công cộng. Mặc định (khuyến nghị): hub chạy thẳng :3000 sandbox hub
// → destination không cần query. Nếu hub sau gateway cần XTransformPort: set WEBHUB_QUERY.
const WEBHUB_ORIGIN = (process.env.WEBHUB_ORIGIN ?? "").replace(/\/+$/, "");
const WEBHUB_QUERY = process.env.WEBHUB_QUERY ?? "";
const WEBHUB_REWRITE_DESTINATION = WEBHUB_ORIGIN
  ? `${WEBHUB_ORIGIN}/v1/chat/completions${WEBHUB_QUERY}`
  : "http://localhost:3003/v1/chat/completions";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // 3.6-H: cho phép dev resource (HMR websocket, font dev) từ các host truy cập console.
  // - 127.0.0.1 / localhost: truy cập trực tiếp trong sandbox (agent-browser, curl).
  // - *.space-z.ai: public URL preview của sandbox (owner mở qua gateway — Host giữ nguyên domain).
  // Không có mục này, Next 16 chặn /_next/hmr + font dev → hydration bị stall trên host lạ.
  allowedDevOrigins: ["127.0.0.1", "localhost", "*.space-z.ai"],
  // WebHub mode (T4-a): client luôn fetch `/v1/chat/completions?XTransformPort=3003`.
  // - Khi chạy QUA GATEWAY sandbox: gateway thấy XTransformPort=3003 → forward thẳng webhub (rewrite không chạy).
  // - Khi truy cập TRỰC TIẾP dev-console (local/agent-browser, không qua gateway): rewrite dưới đây
  //   proxy server-side sang webhub — cùng 1 URL client, 2 ngữ cảnh đều chạy.
  async rewrites() {
    return [
      {
        source: "/v1/chat/completions",
        destination: WEBHUB_REWRITE_DESTINATION,
      },
    ];
  },
  // TEMPORARY compat (Đợt 3 — xem scripts/build-compat.ts): packages/protocol +
  // packages/zai-adapter ship raw TS với import NodeNext './frames.js' mà không có
  // dist — Turbopack áp fullySpecified cho ESM nên không map '.js'→'.ts' được.
  // build-compat.ts bundle 2 package thành JS thuần vào .zai-compat/, alias ở dưới
  // trỏ specifier sang bản đó. BỎ compat này khi packages/ ship dist hoặc đổi style
  // import (flag cho owner + agent 3-a; apps/worker sẽ dính cùng lỗi ở T2-b).
  turbopack: {
    resolveAlias: {
      "@zaiwebhub/zai-adapter": "./.zai-compat/adapter/index.js",
      "@zaiwebhub/protocol": "./.zai-compat/protocol/index.js",
    },
  },
};

export default nextConfig;
