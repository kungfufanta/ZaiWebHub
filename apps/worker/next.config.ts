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
    // Task 3.6-W: file-config.ts (fs/os) có thể lọt vào module graph edge của instrumentation qua
    // dynamic import. Node branch của register() bị DefinePlugin fold bỏ nên edge KHÔNG chạy code này —
    // fallback:false chỉ để webpack edge resolve được, KHÔNG ảnh hưởng build node (builtins external sẵn).
    if (String(config.name ?? '').includes('edge')) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        'node:fs': false,
        os: false,
        'node:os': false,
        path: false,
        'node:path': false,
      };
    }
    return config;
  },
};

export default nextConfig;
