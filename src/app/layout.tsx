import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ATC ERP｜定制生产流转管理系统",
  description: "ATC 本地化销售订单驱动的生产流转管理系统",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
