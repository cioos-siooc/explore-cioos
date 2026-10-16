// Shared by the recorder and the replaying specs so both browsers match.

// Chromium 130+ no longer falls back to SwiftShader without the opt-in, so the
// map never builds. No --disable-gpu: it conflicts with SwiftShader WebGL.
export const CHROMIUM_ARGS = [
  "--enable-unsafe-swiftshader",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--no-sandbox",
  "--disable-dev-shm-usage",
];

// "Now" feeds the default query strings, so fixture keys and dated
// screenshots would otherwise change at midnight.
export const FROZEN_TIME = new Date("2026-01-15T12:00:00Z");

// The app branches at min-width 1400px and max-width 700px; tablet sits
// deliberately between.
export const VIEWPORTS = {
  desktop: { width: 1600, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 },
};

// Spelled out so specs don't depend on components/config.js's default staying put.
export const DEFAULT_VIEW = "?lat=63.3&lon=-95.9&zoom=2.75&lang=en";

// A spec asking for an unrecorded view fails with the missing fixture path:
// add it here and re-record.
export const RECORDED_VIEWS = {
  default: DEFAULT_VIEW,
  filtered: `${DEFAULT_VIEW}&eovs=temperature`,
};
