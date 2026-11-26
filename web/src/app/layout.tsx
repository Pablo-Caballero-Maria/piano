import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/ui/Providers";
import { VercelTelemetry } from "@/components/ui/VercelTelemetry";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme";
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
  // The light theme's; the theme button changes it (lib/theme.ts)
  themeColor: THEME_COLORS.light,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // leading-[normal] and the tap highlight: the browser's defaults, which Tailwind's reset changes.
    // The theme script sets data-theme before React hydrates, hence suppressHydrationWarning.
    <html
      lang="en"
      className="h-full bg-bg leading-[normal] text-fg [-webkit-tap-highlight-color:revert]"
      suppressHydrationWarning
    >
      <head>
        {/* A plain script, not next/script: it must run before the first paint */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="h-full overflow-hidden bg-bg text-fg select-none [-webkit-touch-callout:none]">
        <Providers>{children}</Providers>
        <VercelTelemetry />
      </body>
    </html>
  );
}
