// packages/protocol — hợp đồng duy nhất giữa dev-console ↔ webhub ↔ worker.
// T1-a-1 (Đợt 2) + T1-a-2 (Đợt 2-final) FROZEN — spec: packages/protocol/PLAN.md (F1–F9).
// Package thuần: types + zod + codec. KHÔNG import zsdk. KHÔNG I/O.
// Đổi bất cứ gì trong package này → phải bump PROTOCOL_VERSION + cập nhật PLAN + báo owner.

export const PROTOCOL_VERSION = 1 as const;

export * from './job.js';
export * from './frames.js';
export * from './sse.js';
