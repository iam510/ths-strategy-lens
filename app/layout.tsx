import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "析选 · 可核验的选股条件工作台",
  description:
    "将选股意图转化为可编辑的数据条件，逐项检查入选、排除与缺失依据。研究工具，不提供投资建议。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
