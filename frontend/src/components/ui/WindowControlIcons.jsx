import * as React from "react";

// Windows 11's caption glyphs (minimize, maximize) and a sidebar one, drawn to
// the extent and stroke weight of the shared X (CloseButton) so the three read
// as one row of window controls.
function Glyph({ children, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.7"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function WindowMinimize(props) {
  return (
    <Glyph {...props}>
      <path d="M4.5 8h7" />
    </Glyph>
  );
}

// A window with its title bar, not a bare square, so it reads as "window".
export function WindowMaximize(props) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4.5" width="9" height="7" rx="1" />
      <path d="M3.5 6.5h9" />
    </Glyph>
  );
}

// What a widened page goes back to: the window with the sidebar down its left.
export function WindowSidebar(props) {
  return (
    <Glyph {...props}>
      <rect x="3.5" y="4.5" width="9" height="7" rx="1" />
      <path d="M3.5 6.5h9M6.5 6.5v5" />
    </Glyph>
  );
}
