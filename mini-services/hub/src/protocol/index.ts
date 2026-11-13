// mini-services/worker — src/protocol/index.ts
// Public API của protocol layer (port từ ZaiWebHub packages/protocol).
export * from './job';
export * from './frames';
export * from './sse';

// Protocol version chung 2 đầu (FROZEN — tăng khi wire format đổi).
export const PROTOCOL_VERSION = 1;
