import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { VercelTelemetry } from "@/components/ui/VercelTelemetry";
import "./globals.css";

export const metadata: Metadata = {
  title: "ESP32 Piano",
  description: "Piano lessons with an ESP32 buzzer: play, compose and follow the teacher live.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#14161a",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full bg-bg text-fg">
      <body className="h-full overflow-hidden bg-bg text-fg select-none [-webkit-touch-callout:none]">
        {children}
        <VercelTelemetry />
      </body>
    </html>
  );
}
