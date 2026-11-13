// packages/zai-adapter — reasoning.ts (T1-b)
// Tiện ích preserved thinking (D2 — reserved, MVP chưa dùng): JSON roundtrip thuần.
// content PHẢI giữ NGUYÊN VĂN (cấm sửa/reorder/re-encode — protocol PLAN F5). JSON.stringify/parse
// giữ string verbatim (escape chỉ mang tính wire-format, không đổi nội dung).
import type { ReasoningBlock } from '@/lib/protocol';

/** Serialize blocks thành string để lưu StateStore (D2: `tenant:{tid}:conv:{cid}:reasoning`). */
export function serializeReasoningBlocks(blocks: ReasoningBlock[]): string {
  return JSON.stringify(blocks);
}

/**
 * Parse payload do serializeReasoningBlocks() sinh ra.
 * - rỗng/whitespace → [] (không có preserved thinking).
 * - sai shape → throw Error rõ ràng (caller — hub — quyết định log/ignore; worker không gọi hàm này).
 * - content trả về NGUYÊN VĂN.
 */
export function parseReasoningBlocks(raw: string): ReasoningBlock[] {
  if (!raw || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('invalid reasoning blocks payload: not valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('invalid reasoning blocks payload: expected a JSON array');
  }
  const out: ReasoningBlock[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('invalid reasoning block: not an object');
    }
    const o = item as Record<string, unknown>;
    if (typeof o.turn !== 'number' || !Number.isInteger(o.turn) || o.turn < 0) {
      throw new Error('invalid reasoning block: "turn" must be a non-negative integer');
    }
    if (typeof o.content !== 'string') {
      throw new Error('invalid reasoning block: "content" must be a string');
    }
    out.push({ turn: o.turn, content: o.content }); // verbatim
  }
  return out;
}
