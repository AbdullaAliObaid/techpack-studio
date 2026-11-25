import type { ReactNode } from 'react';

const P: Record<string, ReactNode> = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  add: <><path d="M4 18C8 6 16 6 20 18" /><circle cx="12" cy="9" r="2.2" /><path d="M18 3v5M15.5 5.5h5" /></>,
  pan: <path d="M8 13V6a1.5 1.5 0 013 0v6m0-7a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.5L8 15" />,
  sym: <><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 7L4 12l5 5M15 7l5 5-5 5" /></>,
  measure: <><path d="M3 15l12-12 6 6-12 12z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></>,
  stitch: <path d="M4 20L20 4" strokeDasharray="3 2.5" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" /></>,
  moon: <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />,
  auto: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 010 18z" fill="currentColor" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6.5A2.5 2.5 0 0013.5 4h-7A2.5 2.5 0 004 6.5v7A2.5 2.5 0 006.5 16H8" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 015.5 5H9l2 2.5h7.5A2.5 2.5 0 0121 10v7.5a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z" />,
  share: <><path d="M12 15V3M8 7l4-4 4 4" /><path d="M6 11H5.5A2.5 2.5 0 003 13.5v5A2.5 2.5 0 005.5 21h13a2.5 2.5 0 002.5-2.5v-5a2.5 2.5 0 00-2.5-2.5H18" /></>,
  refresh: <path d="M20 12a8 8 0 11-2.6-5.9M20 4v5h-5" />,
  library: <><rect x="3.5" y="3.5" width="7" height="7" rx="2" /><rect x="13.5" y="3.5" width="7" height="7" rx="2" /><rect x="3.5" y="13.5" width="7" height="7" rx="2" /><rect x="13.5" y="13.5" width="7" height="7" rx="2" /></>,
  seams: <path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" />,
  pleat: <path d="M3 6l4 12 5-12 5 12 4-12" />,
  pen: <path d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4" />,
  patch: <><rect x="4.5" y="4.5" width="15" height="15" rx="3.5" strokeDasharray="3 2.5" /><path d="M9 12h6M12 9v6" /></>,
  pose: <><circle cx="12" cy="4.8" r="2" /><path d="M12 8v6M5 10l7-2 7 2M12 14l-4 7M12 14l4 7" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeoff: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /><path d="M4 4l16 16" /></>,
  flip: <><path d="M12 3v18" strokeDasharray="2 2" /><path d="M8 7L3 17h5zM16 7l5 10h-5z" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 017.5-2" /></>,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  grid: <path d="M4 4h16v16H4zM4 12h16M12 4v16" />,
};

export default function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}
