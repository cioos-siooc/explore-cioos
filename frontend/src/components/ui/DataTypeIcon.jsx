import * as React from "react";

// The map's latest-position arrow (TrackHeadIcon), heading north-east from
// the end of the track at (x, y).
const trackHead = (x, y) => (
  <path
    d="M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z"
    fill="currentColor"
    stroke="none"
    transform={`translate(${x} ${y}) rotate(45) scale(0.5) translate(-8 -8)`}
  />
);

// One glyph per data layer key (state/dataLayers.js): where the samples sit in
// space and time, drawn in a 16px box.
const PATHS = {
  point: <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />,
  timeseries: <path d="M1.5 9h2.5l2-5 3 8 2-5h3.5" />,
  // A cast: the instrument lowered from the sea surface.
  profile: (
    <>
      <path d="M1.5 3.5q1.5-1.5 3 0t3 0 3 0 3 0M8 3.5V11" />
      <rect x="6" y="11" width="4" height="3.5" rx="1" fill="currentColor" />
    </>
  ),
  // A mooring: a float and sensors on a line anchored to the seabed.
  timeseriesProfile: (
    <>
      <path d="M1.5 3.5q1.5-1.5 3 0t3 0 3 0 3 0M2 14.5h12M8 7.5v7" />
      <circle cx="8" cy="6.5" r="1.75" fill="currentColor" />
      <path d="M6.5 10h3M6.5 12.5h3" />
    </>
  ),
  trajectories: (
    <>
      <path d="M1.5 14.5c3 0 3-6 6-5.5s3-2.5 4-4" />
      {trackHead(12.6, 3.4)}
    </>
  ),
  trajectoryProfile: (
    <>
      <path d="M1.5 7.5c3-2 5 1 8-1l1.5-1.5M4 6.5v8M8 7v7.5" />
      {trackHead(12.6, 3.4)}
    </>
  ),
  grid: (
    <>
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M6 2v12M10 2v12M2 6h12M2 10h12" />
    </>
  ),
};

export default function DataTypeIcon({ layerKey, size = 13, ...props }) {
  const shape = PATHS[layerKey];
  if (!shape) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {shape}
    </svg>
  );
}
