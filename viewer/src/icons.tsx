import type { ReactNode } from "react";

const PATHS: Record<string, ReactNode> = {
  move: (
    <>
      <path d="M12 3v18M3 12h18" />
      <path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
    </>
  ),
  wall: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M3 10h18M3 15h18M9 5v5M15 10v5M9 15v4" />
    </>
  ),
  food: (
    <>
      <path d="M4 11a8 6 0 0 1 16 0z" />
      <path d="M3 14h18M5 17h14a0 0 0 0 1 0 0 3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
    </>
  ),
  enemy: (
    <>
      <ellipse cx="12" cy="14" rx="4" ry="5" />
      <path d="M8 12c-3-1-5-4-4-7 3 0 5 2 5 5M16 12c3-1 5-4 4-7-3 0-5 2-5 5M10 9l-1-3M14 9l1-3" />
    </>
  ),
  pad: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  erase: (
    <>
      <path d="M4 16l9-10 7 6-6 8H8z" />
      <path d="M9 20h11M8.5 11.5l6 5" />
    </>
  ),
  yard: (
    <>
      <path d="M12 3l5 8h-3l4 6H6l4-6H7z" />
      <path d="M12 17v4" />
    </>
  ),
  maze: (
    <path d="M3 3h18v18H3zM3 9h12M9 15h12M15 9v6M9 9v-6" />
  ),
  hunter: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v6M12 16v6M2 12h6M16 12h6" />
    </>
  ),
  gate: (
    <>
      <path d="M4 21V11a8 8 0 0 1 16 0v10" />
      <path d="M9 21v-7a3 3 0 0 1 6 0v7" />
    </>
  ),
  still: (
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  ),
  play: <path d="M7 4l13 8-13 8z" />,
  pause: <path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" />,
  step: <path d="M5 4l11 8-11 8zM19 4v16" />,
  reset: (
    <>
      <path d="M4 12a8 8 0 1 0 3-6.2" />
      <path d="M4 3v5h5" />
    </>
  ),
  follow: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  orbit: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="4" />
      <circle cx="12" cy="12" r="2" />
    </>
  ),
  overview: (
    <>
      <path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5" />
      <rect x="8" y="8" width="8" height="8" />
    </>
  ),
  recenter: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="1.5" />
    </>
  ),
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
