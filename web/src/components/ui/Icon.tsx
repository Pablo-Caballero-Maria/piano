/**
 * Icons: inline SVG symbols (emoji fonts are missing on some PCs and look different on each phone).
 * <IconSprite/> defines them once; <Icon name="play"/> uses one.
 */
import { ICON } from "./classes";

const ICONS = {
  piano: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 13v7M15 13v7" />
      <path d="M7.5 4v9h3V4M13.5 4v9h3V4" fill="currentColor" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  vol: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="m22 9-6 6M16 9l6 6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  save: (
    <>
      <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M7 3v5h8V3M7 21v-7h10v7" />
    </>
  ),
  start: (
    <>
      <path d="M6 5v14" />
      <path d="m19 5-10 7 10 7z" fill="currentColor" />
    </>
  ),
  play: <path d="m7 4 13 8-13 8z" fill="currentColor" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />,
  rec: <circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none" />,
  loop: (
    <>
      <path d="m17 2 3 3-3 3" />
      <path d="M4 11V9a4 4 0 0 1 4-4h12" />
      <path d="m7 22-3-3 3-3" />
      <path d="M20 13v2a4 4 0 0 1-4 4H4" />
    </>
  ),
  metro: (
    <>
      <path d="M9 3h6l4 18H5z" />
      <path d="M8 16h8M12 16l5-10" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13 7 4 4" />
    </>
  ),
  eraser: (
    <>
      <path d="m16 3 5 5-11 11H6l-3-3z" />
      <path d="m11 8 5 5M9 21h12" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9a5 5 0 0 0 0 10h3" />
    </>
  ),
  zin: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-5-5M8 11h6M11 8v6" />
    </>
  ),
  zout: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-5-5M8 11h6" />
    </>
  ),
  trash: <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />,
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  class: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
} as const;

export type IconName = keyof typeof ICONS;

/** The symbols every <Icon/> refers to (once per page). */
export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        {Object.entries(ICONS).map(([name, shape]) => (
          <symbol key={name} id={`i-${name}`} viewBox="0 0 24 24">
            {shape}
          </symbol>
        ))}
      </defs>
    </svg>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className={ICON} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
