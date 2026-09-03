// Shared between the recorder, the Playwright config and the specs, so the
// browser that records fixtures and the browser that replays them are set up
// identically.

// MapLibre needs a real WebGL context. Chromium stopped falling back to
// SwiftShader automatically in 130 — context creation now fails outright unless
// this opt-in is passed, which would leave the map unbuilt and the first-paint
// signal never firing.
//
// Note there is deliberately no --disable-gpu here: it conflicts with
// SwiftShader WebGL. (The puppeteer smoke test this suite replaces passed it,
// which is one of the reasons its launch config was not carried forward.)
export const CHROMIUM_ARGS = [
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--no-sandbox',
  '--disable-dev-shm-usage'
]

// Everything in the app that means "now" derives from this: defaultEndDate in
// components/config.js is `new Date().toISOString()` evaluated at module load,
// and the trajectory scrub time defaults to today. Without a fixed clock the
// query strings the app sends — and therefore the fixture keys, and therefore
// any screenshot showing a date — change at midnight.
export const FROZEN_TIME = new Date('2026-01-15T12:00:00Z')

// The viewport rungs the app itself branches on: (min-width: 1400px) in
// UIProvider decides whether the datasets sidebar starts open, and
// (max-width: 700px) in useMediaQuery is the rung where the chrome becomes
// full-screen sheets. Tablet sits deliberately between the two.
export const VIEWPORTS = {
  desktop: { width: 1600, height: 900 },
  tablet: { width: 1024, height: 768 },
  mobile: { width: 390, height: 844 }
}

// The default camera, from components/config.js. Spelled out so a spec can
// deep-link to the same view the app opens at without depending on the default
// staying put.
export const DEFAULT_VIEW = '?lat=63.3&lon=-95.9&zoom=2.75&lang=en'

// The states the recorder visits. Keep this list and the specs in step: a spec
// asking for a view that was never recorded fails with the missing fixture path,
// which is the signal to add it here and re-record.
export const RECORDED_VIEWS = {
  default: DEFAULT_VIEW,
  // One filtered view, so the specs can assert that applying a filter actually
  // changes the counts rather than just changing the URL.
  filtered: `${DEFAULT_VIEW}&eovs=temperature`
}
