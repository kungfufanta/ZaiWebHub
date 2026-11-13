// packages/zai-adapter — scripts/smoke-adapter.ts (T1-b DoD)
// Smoke THẬT zsdk qua streamChat() — KHÔNG phải test framework. Chạy bằng Node (KHÔNG bun runtime):
//   cd packages/zai-adapter && node scripts/smoke-adapter.ts
// Node >= 22 chạy TS native (type-stripping). Script import '../src/index.ts' (extension .ts thật —
// file này KHÔNG nằm trong tsconfig include:["src"] nên không ảnh hưởng `tsc --noEmit`).
//
// 3 kịch bản (README DoD T1-b):
//   1) stream thật (UPSTREAM=proxy sandbox): TTFB, tổng thời gian, số frame `data:`, `data: [DONE]`,
//      finish_reason/usage (qua createSseMetadataScanner F6), có/không `delta.reasoning_content`.
//      G2-4: qua proxy nội bộ sandbox dự kiến 0 reasoning chunk — khi đó nhãn = mock-verified cho reasoning path.
//   2) AbortSignal giữa stream → stream đóng sạch, 0 byte sau abort.
//   3) Lỗi trước-stream (UPSTREAM=real không ZAI_API_KEY) → đúng 1 `event: error` rồi đóng, KHÔNG throw.
//
// SECURITY (T3-f baseline): script CHỈ in metadata/số đếm — KHÔNG bao giờ in nội dung message,
// nội dung reasoning hay bất kỳ key/token nào.
import { createSseMetadataScanner, streamChat } from '../src/index.ts';

/** Prompt >= 200 từ (DoD T1-b: "1 prompt ý tưởng dài"). */
const PROMPT = [
  'Bạn là cố vấn sản phẩm. Hãy brainstorm chi tiết 10 ý tưởng sản phẩm phần mềm dành cho lập trình viên indie',
  'trong năm tới: với mỗi ý tưởng nêu ngắn gọn (1) bài toán thực tế và người dùng mục tiêu, (2) tính năng lõi',
  'khác biệt so với đối thủ, (3) mô hình kiếm tiền, (4) rủi ro lớn nhất khi thực thi. Ưu tiên các ý tưởng có',
  'thể xây dựng MVP trong 4 tuần bởi 1 người, tận dụng LLM nhưng không phụ thuộc hoàn toàn vào LLM, có cơ chế',
  'phân phối rõ ràng qua cộng đồng developer (open-core, CLI, plugin ecosystem, template marketplace...).',
  'Kết thúc bằng bảng so sánh nhanh effort/impact và gợi ý 3 ý tưởng đáng làm nhất cho một nhóm 2 người muốn',
  'ra sản phẩm trả phí trong quý đầu tiên. Viết bằng tiếng Việt, giọng thực dụng, tránh buzzword.',
].join(' ');

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let idx = text.indexOf(needle);
  while (idx >= 0) {
    count += 1;
    idx = text.indexOf(needle, idx + needle.length);
  }
  return count;
}

async function readAll(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (value: Uint8Array) => void,
): Promise<{ totalBytes: number; chunks: number }> {
  const reader = stream.getReader();
  let totalBytes = 0;
  let chunks = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      chunks += 1;
      onChunk?.(value);
    }
  }
  return { totalBytes, chunks };
}

async function smokeMainStream(): Promise<void> {
  console.log('[smoke] 1) main stream (UPSTREAM=proxy, zsdk thật)...');
  const t0 = Date.now();
  let ttfbMs = -1;
  let maxGapMs = 0;
  let lastByteAt = t0;
  let sawReasoning = false;
  let dataFrames = 0;
  const scanner = createSseMetadataScanner();
  const decoder = new TextDecoder();

  const stream = streamChat({
    messages: [{ role: 'user', content: PROMPT }],
    model: 'glm-5.3',
    thinking: { type: 'enabled' },
  });
  const { totalBytes, chunks } = await readAll(stream, (value) => {
    const now = Date.now();
    if (ttfbMs < 0) ttfbMs = now - t0;
    maxGapMs = Math.max(maxGapMs, now - lastByteAt);
    lastByteAt = now;
    scanner.feed(value); // F6: feed MỌI byte — bytes vẫn được đếm nguyên xi song song
    const text = decoder.decode(value, { stream: true });
    dataFrames += countOccurrences(text, 'data:');
    if (text.includes('reasoning_content')) sawReasoning = true;
  });
  const meta = scanner.result();
  const totalMs = Date.now() - t0;
  console.log(
    JSON.stringify(
      {
        test: 'main-stream',
        ttfb_ms: ttfbMs,
        total_ms: totalMs,
        max_gap_ms: maxGapMs,
        total_bytes: totalBytes,
        ws_chunk_equiv: chunks, // số chunk nhận từ ReadableStream (≈ số WS binary frame tương lai)
        data_frames: dataFrames,
        sse_done: meta.done,
        finish_reason: meta.finish_reason ?? null,
        usage: meta.usage ?? null,
        saw_reasoning_content: sawReasoning,
        note: sawReasoning
          ? 'reasoning_content xuất hiện (nếu chạy trên VPS UPSTREAM=real)'
          : '0 reasoning chunk — khớp G2-4 (proxy sandbox không emit reasoning) → reasoning path chỉ mock-verified',
      },
      null,
      2,
    ),
  );
}

async function smokeAbort(): Promise<void> {
  console.log('[smoke] 2) AbortSignal mid-stream...');
  const controller = new AbortController();
  const stream = streamChat(
    { messages: [{ role: 'user', content: PROMPT }], model: 'glm-5.3', thinking: { type: 'enabled' } },
    { signal: controller.signal },
  );
  const reader = stream.getReader();
  let preAbortBytes = 0;
  for (let i = 0; i < 2; i += 1) {
    const { done, value } = await reader.read();
    if (done) break;
    preAbortBytes += value.byteLength;
  }
  controller.abort();
  let postAbortBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    postAbortBytes += value.byteLength;
  }
  console.log(
    JSON.stringify({
      test: 'abort-mid-stream',
      pre_abort_bytes: preAbortBytes,
      post_abort_bytes: postAbortBytes,
      ok: postAbortBytes === 0,
    }),
  );
}

async function smokePreStreamError(): Promise<void> {
  console.log('[smoke] 3) pre-stream error (UPSTREAM=real, no ZAI_API_KEY)...');
  const prevMode = process.env.UPSTREAM;
  const prevKey = process.env.ZAI_API_KEY;
  process.env.UPSTREAM = 'real';
  delete process.env.ZAI_API_KEY;
  try {
    const stream = streamChat({ messages: [{ role: 'user', content: 'ping' }] });
    const decoder = new TextDecoder();
    let text = '';
    let threw: unknown = null;
    try {
      const { totalBytes, chunks } = await readAll(stream, (value) => {
        text += decoder.decode(value, { stream: true });
      });
      void totalBytes;
      console.log(
        JSON.stringify({
          test: 'pre-stream-error',
          chunks,
          error_frame_count: countOccurrences(text, 'event: error'),
          threw_to_caller: false,
          // frame lỗi đã qua sanitize (redact ZAI_API_KEY, bỏ newline → 1 dòng) — an toàn để in
          frame: text.slice(0, 300),
        }),
      );
    } catch (err) {
      threw = err; // contract: KHÔNG được xảy ra
    }
    if (threw) {
      console.log(
        JSON.stringify({ test: 'pre-stream-error', threw_to_caller: true, ok: false }),
      );
    }
  } finally {
    if (prevMode === undefined) delete process.env.UPSTREAM;
    else process.env.UPSTREAM = prevMode;
    if (prevKey !== undefined) process.env.ZAI_API_KEY = prevKey;
  }
}

async function main(): Promise<void> {
  const mode = process.env.UPSTREAM === 'real' ? 'real' : 'proxy';
  console.log(`[smoke] UPSTREAM=${mode} (main stream test luôn chạy ở mode hiện tại của env)`);
  await smokeMainStream();
  await smokeAbort();
  await smokePreStreamError();
  console.log('[smoke] done');
}

main().catch((err) => {
  console.error('[smoke] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
