// A matchMedia jsdom can answer, backed by a width a test can change.
//
// The app branches on two rungs — WIDE_SCREEN_QUERY '(min-width: 1400px)' in
// UIProvider and MOBILE_QUERY '(max-width: 700px)' in useMediaQuery.js — so a
// test that wants to assert breakpoint behaviour needs to move the viewport and
// have live queries fire 'change', which is what useMediaQuery subscribes to.

export const DESKTOP_WIDTH = 1600;
export const TABLET_WIDTH = 1024;
export const MOBILE_WIDTH = 390;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let currentWidth = DESKTOP_WIDTH;
const liveQueries = new Set();

// Only the forms this codebase writes. Anything else is a typo in a test, and
// answering it `false` would hide that. Reduced motion is off, as on most
// machines, so animations run their real course under test.
function evaluate(query) {
  if (query.trim() === REDUCED_MOTION_QUERY) return false;
  const match = /^\(\s*(min|max)-width:\s*(\d+)px\s*\)$/.exec(query.trim());
  if (!match) {
    throw new Error(
      `Unsupported media query in test: "${query}". ` +
        "Only (min-width: Npx), (max-width: Npx) and reduced motion are handled — see src/test/viewport.js.",
    );
  }
  const [, bound, px] = match;
  return bound === "min"
    ? currentWidth >= Number(px)
    : currentWidth <= Number(px);
}

export function installMatchMedia() {
  window.matchMedia = (query) => {
    const listeners = new Set();
    const mql = {
      media: query,
      get matches() {
        return evaluate(query);
      },
      addEventListener: (type, listener) => {
        if (type === "change") listeners.add(listener);
      },
      removeEventListener: (type, listener) => {
        if (type === "change") listeners.delete(listener);
        if (listeners.size === 0) liveQueries.delete(mql);
      },
      // Deprecated aliases, in case a dependency reaches for them.
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
      dispatch: () => {
        const event = { matches: evaluate(query), media: query };
        listeners.forEach((listener) => listener(event));
      },
    };
    liveQueries.add(mql);
    return mql;
  };
}

// Move the viewport and notify every subscribed query, the way a real resize
// does. Call it inside act() when the change should flush React updates.
export function setViewportWidth(width) {
  currentWidth = width;
  window.innerWidth = width;
  liveQueries.forEach((mql) => mql.dispatch());
}

export function resetViewport() {
  currentWidth = DESKTOP_WIDTH;
  liveQueries.clear();
}
