import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IconSprite } from "@/components/ui/Icon";
import { VercelTelemetry } from "@/components/ui/VercelTelemetry";
import "@/styles/base.css";
import "@/styles/header.css";
import "@/styles/keyboard.css";
import "@/styles/studio.css";
import "@/styles/dialogs.css";
import "@/styles/small-screens.css";

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
    <html lang="en">
      <body>
        <IconSprite />
        {children}
        <VercelTelemetry />
      </body>
    </html>
  );
}
