import React from "react";

import { trackLineColor } from "../../config.js";

// No white halo, unlike the map's arrow: on the white legend and dialog it was
// invisible and only shrank the glyph.
export default function TrackHeadIcon({ size = 12, className }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      // Cropped to the rotated arrow's bounds, so it fills its box as the
      // bootstrap glyphs beside it in the help dialog do.
      viewBox="0.2 3.4 12.4 12.4"
      aria-hidden="true"
    >
      <path
        d="M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z"
        fill={trackLineColor}
        transform="rotate(45 8 8)"
      />
    </svg>
  );
}
