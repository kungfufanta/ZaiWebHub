import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { HubNav } from "@/components/hub-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ZaiWebHub Hub UI — console · workers · stats",
  description:
    "Bảng điều khiển dev kiểm tra luồng SSE thinking → answer bằng endpoint mock (/api/mock-chat), phát đúng wire contract của packages/protocol.",
  keywords: ["ZaiWebHub", "dev-console", "SSE", "mock", "thinking mode", "Next.js", "protocol"],
  authors: [{ name: "ZaiWebHub Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ZaiWebHub dev-console — MOCK mode",
    description: "Kiểm tra stream SSE không đứt đoạn bằng mock emitter đúng wire contract",
    siteName: "ZaiWebHub",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <HubNav />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
