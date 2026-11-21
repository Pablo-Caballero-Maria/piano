import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * Vercel Web Analytics (page views, cookieless) and Speed Insights (Core Web Vitals of real
 * visits), only in the build Vercel makes (`VERCEL=1` at build time). The teacher's PC builds the
 * same site without it: in the classroom nothing is sent anywhere, and the `/_vercel/…` scripts,
 * which only Vercel serves, are never requested.
 */
export function VercelTelemetry() {
  if (!process.env.VERCEL) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
