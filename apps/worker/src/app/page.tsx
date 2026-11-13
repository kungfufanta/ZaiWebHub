// apps/worker — Next.js server component (D1: Node runtime, KHONG Bun).
// Trang place-holder de xac nhan boot OK; WS client outbound nam o src/instrumentation.ts (T2-a).

const styles = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    margin: 0,
  },
  h1: {
    margin: 0,
    fontSize: '2rem',
  },
  pre: {
    fontFamily: 'ui-monospace, monospace',
    background: '#f4f4f5',
    padding: '8px 12px',
    borderRadius: '6px',
  },
  p: {
    maxWidth: '640px',
    textAlign: 'center' as const,
    color: '#555',
  },
};

export default function Page() {
  const mode = process.env.MODE ?? 'worker';
  const hubUrl = process.env.HUB_URL ?? '(chua cau hinh)';

  return (
    <main style={styles.page}>
      <h1 style={styles.h1}>ZaiWebHub Worker</h1>
      <pre style={styles.pre}>
        {'MODE = '}
        {mode}
        {'\nHUB_URL = '}
        {hubUrl}
      </pre>
      <p style={styles.p}>
        Worker chay trong sandbox Z.AI. WS client outbound khoi dong qua
        instrumentation.ts (T2-a). Mode relay = proxy fallback cung codebase (T4-d).
      </p>
    </main>
  );
}
