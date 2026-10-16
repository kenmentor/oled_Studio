import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OLED Studio — Voice Infrastructure",
  description: "OLED Studio — Nigerian-accent voice infrastructure. Type it. Hear it. Live.",
  icons: { icon: `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.png` },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
};

import VisitTracker from "@/components/visit-tracker";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-void font-sans">
        <VisitTracker />
        {children}
      </body>
    </html>
  );
}