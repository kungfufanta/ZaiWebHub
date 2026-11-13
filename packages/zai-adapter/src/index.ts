// packages/zai-adapter — public API (T1-b). Spec: packages/zai-adapter/README.MD.
// KHÔNG nơi nào khác trong repo được import 'z-ai-web-dev-sdk' trực tiếp — chỉ adapter này.
export * from './types.js';
export * from './reasoning.js';
export * from './stream.js';

// F6 (Đợt 2-final): scanner metadata tối thiểu — worker feed() MỌI byte đi qua (bytes vẫn nguyên xi)
// rồi result() để biết khi nào gửi job.done. Adapter API contract yêu cầu re-export từ protocol.
export { createSseMetadataScanner, buildSseErrorFrame } from '@zaiwebhub/protocol';

// Re-export types nền từ protocol FROZEN cho tiện consumer của adapter.
export type { ChatMessage, ReasoningBlock } from '@zaiwebhub/protocol';
