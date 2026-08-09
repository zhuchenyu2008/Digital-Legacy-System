import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MaterialSymbolsRuntime } from "../components/fonts/material-symbols";
import "./globals.css";

export const metadata: Metadata = {
  title: "Digital Legacy System",
  description: "数字遗产系统本地 V1",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link crossOrigin="anonymous" href="https://fonts.gstatic.com" rel="preconnect" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400,0,0&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <MaterialSymbolsRuntime />
        {children}
      </body>
    </html>
  );
}
