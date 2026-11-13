/**
 * Định nghĩa các chế độ endpoint (T1-c nửa 2 / T4-a prep).
 *
 * Quy tắc gateway sandbox (BẮT BUỘC): mọi fetch từ browser đều là RELATIVE URL —
 * CẤM ghi port/địa chỉ tuyệt đối. Khi cần chạm mini-service khác port, dùng
 * query `?XTransformPort=<port>` (gateway sandbox tự rewrite).
 */

export type EndpointMode = 'mock' | 'adapter' | 'webhub';

/** Đường dẫn mock cục bộ (Next.js route — cùng origin với UI). */
export const MOCK_PATH = '/api/mock-chat';

/** Đường dẫn route gọi thẳng adapter (server-side import @zaiwebhub/zai-adapter). */
export const ADAPTER_PATH = '/api/adapter-chat';

/**
 * WebHub thật (T4-a). Relative URL + XTransformPort=3003 — KHÔNG ghi port trực tiếp
 * vào URL tuyệt đối. Header auth dùng dev default key `zhb_dev_default_key` —
 * đây là key dev PUBLIC theo thiết kế sandbox (T3-e MVP single tenant), KHÔNG phải secret.
 */
export const WEBHUB_PATH = '/v1/chat/completions?XTransformPort=3003';
export const WEBHUB_DEV_KEY = 'zhb_dev_default_key';

/** Model mặc định cho WebHub mode theo spec T4-a. */
export const WEBHUB_DEFAULT_MODEL = 'glm-5.3';

export const ENDPOINT_STORAGE_KEY = 'zaiwebhub-dev-console.endpoint.v1';

export interface EndpointModeMeta {
  value: EndpointMode;
  label: string;
  /** Nhãn xác minh bắt buộc (PLANS.md section 8 #7): mock-verified / no-reasoning (proxy). */
  verifyLabel: string;
  hint: string;
}

export const ENDPOINT_MODES: EndpointModeMeta[] = [
  {
    value: 'mock',
    label: 'Mock',
    verifyLabel: 'mock-verified',
    hint: '/api/mock-chat — bộ phát SSE giả lập wire upstream-native (F4)',
  },
  {
    value: 'adapter',
    label: 'Adapter',
    verifyLabel: 'no-reasoning (proxy)',
    hint: '/api/adapter-chat — streamChat() thật của @zaiwebhub/zai-adapter (zsdk, server-side)',
  },
  {
    value: 'webhub',
    label: 'WebHub (E2E)',
    verifyLabel: 'no-reasoning (proxy)',
    hint: '/v1/chat/completions?XTransformPort=3003 — SSE pass-through qua hub thật (T4-a)',
  },
];

export function isEndpointMode(value: unknown): value is EndpointMode {
  return value === 'mock' || value === 'adapter' || value === 'webhub';
}

export function endpointModeMeta(mode: EndpointMode): EndpointModeMeta {
  return ENDPOINT_MODES.find((m) => m.value === mode) ?? ENDPOINT_MODES[0];
}

/**
 * URL cho mỗi mode. `NEXT_PUBLIC_CHAT_ENDPOINT` (nếu set) ghi đè đường dẫn mock —
 * giữ nguyên hành vi T1-c-mock (override build-time cho T4-a demo); 2 mode còn lại
 * có đường dẫn cố định theo contract.
 */
export function endpointUrlFor(mode: EndpointMode): string {
  switch (mode) {
    case 'adapter':
      return ADAPTER_PATH;
    case 'webhub':
      return WEBHUB_PATH;
    default:
      return process.env.NEXT_PUBLIC_CHAT_ENDPOINT || MOCK_PATH;
  }
}

export const DEFAULT_ENDPOINT_MODE: EndpointMode = 'mock';
