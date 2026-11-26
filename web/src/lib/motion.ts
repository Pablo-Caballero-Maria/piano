/**
 * The few animations made with motion, shared so they feel alike: short and subtle, only for
 * things that appear after an action (never the prerendered page, which would stay hidden until
 * the JavaScript loads), and none when the system asks for reduced motion (Providers.tsx).
 */

/** Fades in while rising a few pixels; fades out the same way. */
export const rise = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
} as const;

/** A message that comes up from the bottom edge, and goes back down. */
export const toastMotion = {
  initial: { opacity: 0, y: 16, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.98 },
  transition: { type: "spring", stiffness: 500, damping: 38 },
} as const;
