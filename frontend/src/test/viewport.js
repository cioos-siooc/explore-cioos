export const DESKTOP_WIDTH = 1600;
export const TABLET_WIDTH = 1024;
export const MOBILE_WIDTH = 390;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const TOUCH_QUERY = "(hover: none)";
// react-data-table-component reads it on mount to pick its default theme.
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

let currentWidth = DESKTOP_WIDTH;
let touchScreen = false;
const liveQueries = new Set();

// Only the forms this codebase writes; anything else is a typo, and answering
// `false` would hide it. Height never moves, so (max-height) reads as tall.
function evaluate(query) {
  if (query.includes(",")) return query.split(",").some(evaluate);
  if (/^\(\s*max-height:\s*\d+px\s*\)$/.test(query.trim())) return false;
  if (query.trim() === REDUCED_MOTION_QUERY) return false;
  if (query.trim() === TOUCH_QUERY) return touchScreen;
  if (query.trim() === DARK_SCHEME_QUERY) return false;
  const match = /^\(\s*(min|max)-width:\s*(\d+)px\s*\)$/.exec(query.trim());
  if (!match) {
    throw new Error(
      `Unsupported media query in test: "${query}". ` +
        "Only (min-width: Npx), (max-width: Npx), (max-height: Npx), comma lists of those, (hover: none), reduced motion and dark scheme are handled — see src/test/viewport.js.",
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

// Call inside act() when the change should flush React updates.
export function setViewportWidth(width) {
  currentWidth = width;
  window.innerWidth = width;
  liveQueries.forEach((mql) => mql.dispatch());
}

export function setTouchScreen(touch) {
  touchScreen = touch;
  liveQueries.forEach((mql) => mql.dispatch());
}

export function resetViewport() {
  currentWidth = DESKTOP_WIDTH;
  touchScreen = false;
  liveQueries.clear();
}
