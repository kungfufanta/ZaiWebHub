// mini-services/worker — src/zai-adapter/index.ts
// Public API của adapter layer (port từ ZaiWebHub packages/zai-adapter).
// CHỈ module này được import 'z-ai-web-dev-sdk' — mọi phần khác của worker cấm đụng zsdk.
export * from './types';
export * from './stream';
export { createSseMetadataScanner, buildSseErrorFrame } from '../protocol';
export type { ChatMessage, ReasoningBlock } from '../protocol';
