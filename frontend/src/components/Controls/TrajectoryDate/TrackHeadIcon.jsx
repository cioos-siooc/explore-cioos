import React from "react";

import { trackLineColor } from "../../config.js";

// The map's white edge, plus a shadow: on the white legend and dialogs the
// edge alone was invisible and only shrank the glyph.
export default function TrackHeadIcon({
  size = 12,
  className,
  color = trackLineColor,
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      // Cropped to the rotated, outlined arrow's bounds, so it fills its box as
      // the bootstrap glyphs beside it in the help dialog do.
      viewBox="-0.8 2.4 14.4 14.4"
      style={{ filter: "drop-shadow(0 1px 1px rgb(21 47 55 / 45%))" }}
      aria-hidden="true"
    >
      <path
        d="M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z"
        fill={color}
        stroke="var(--cioos-white)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        paintOrder="stroke"
        transform="rotate(45 8 8)"
      />
    </svg>
  );
}
