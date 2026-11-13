import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZaiWebHub Worker',
  description:
    'Worker sandbox cho ZaiWebHub — setup một lần qua UI (paste hub URL + secret), tự connect outbound tới hub.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body className="bg-zinc-50 text-zinc-900 antialiased">{children}</body>
    </html>
  );
}
