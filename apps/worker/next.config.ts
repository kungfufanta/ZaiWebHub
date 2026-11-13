import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // zsdk đọc config từ /etc/.z-ai-config qua fs và dùng fetch trực tiếp; ws là lib server-only
  // → giữ external để tránh quirk khi bundle trong server graph (Node runtime, D1).
  serverExternalPackages: ['z-ai-web-dev-sdk', 'ws'],
  // packages/protocol + packages/zai-adapter dùng style NodeNext (`import './job.js'` trỏ tới file .ts,
  // package KHÔNG được sửa — FROZEN). Webpack cần extensionAlias để resolve '.js' → '.ts'.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts'],
      '.mjs': ['.mjs', '.mts'],
      '.cjs': ['.cjs', '.cts'],
    };
    return config;
  },
};

export default nextConfig;
