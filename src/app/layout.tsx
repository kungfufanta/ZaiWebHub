import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

// 4.4-D: BỎ next/font/google (Geist) — fetch font từ Google lúc BUILD; runner deploy
// bị chặn internet → nextFontError('Failed to fetch') → build FAIL → deploy "Failed"
// trắng 500. Font stack hệ thống định nghĩa trực tiếp trong globals.css (--font-geist-*),
// không phụ thuộc network lúc build lẫn runtime.

export const metadata: Metadata = {
  title: "ZaiWebHub Hub UI — console · workers · stats · docs · worker",
  description:
    "1-repo sandbox edition: console chat SSE 3 mode (mock/adapter/webhub), hub mini-service :3003, worker mini-service :3005. Toàn bộ UI trên 1 route duy nhất qua Caddy gateway.",
  keywords: ["ZaiWebHub", "hub", "console", "worker", "SSE", "sandbox", "WebSocket"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
