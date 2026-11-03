import { useEffect, useState } from "react";

import { usePersistentState } from "../usePersistentState.js";

// Written from the frontend container's NOTICES env at start (notices.sh), so a
// deployment changes its messages with a restart rather than a rebuild.
const NOTICES_URL = new URL(
  `${process.env.BASE_URL}notices.json`,
  window.location.origin,
).href;

export const NOTICE_ICONS = [
  "megaphone",
  "info",
  "warning",
  "maintenance",
  "new",
  "event",
  "none",
];
export const NOTICE_TONES = ["info", "warning", "critical"];
const TONE_ICONS = { info: "info", warning: "warning", critical: "warning" };
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const WHITE = "#ffffff";
const NAVY = "#152f37";

function isValid(notice) {
  return (
    notice !== null &&
    typeof notice === "object" &&
    typeof notice.id === "string" &&
    notice.id !== "" &&
    typeof notice.en === "string" &&
    (notice.fr === undefined || typeof notice.fr === "string") &&
    [notice.starts, notice.expires].every(
      (date) => date === undefined || !Number.isNaN(Date.parse(date)),
    ) &&
    (notice.background === undefined || HEX_COLOR.test(notice.background)) &&
    (notice.icon === undefined || NOTICE_ICONS.includes(notice.icon)) &&
    (notice.css === undefined || typeof notice.css === "string") &&
    (notice.tone === undefined || NOTICE_TONES.includes(notice.tone))
  );
}

export function parseNotices(raw, now = Date.now()) {
  if (!Array.isArray(raw)) {
    console.error("notices.json is not an array; showing no notices");
    return [];
  }
  return raw.filter((notice) => {
    if (!isValid(notice)) {
      console.error("skipping malformed notice:", notice);
      return false;
    }
    return (
      (notice.starts === undefined || Date.parse(notice.starts) <= now) &&
      (notice.expires === undefined || Date.parse(notice.expires) > now)
    );
  });
}

// One of NOTICE_ICONS: the notice's own, else its tone's, else the megaphone.
export function noticeIcon(notice) {
  return notice.icon ?? TONE_ICONS[notice.tone] ?? "megaphone";
}

export function noticeText(notice, language) {
  return notice[language] || notice.en;
}

function luminance(hex) {
  const digits =
    hex.length === 4
      ? [...hex.slice(1)].map((d) => d + d).join("")
      : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(digits.slice(i, i + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// "border-radius: 4px; --x: 1" to React's { borderRadius: "4px", "--x": "1" }.
function parseCss(css) {
  const style = {};
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (!property || !value) continue;
    const key = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    style[key] = value;
  }
  return style;
}

// `background` is the simple option: the text follows whichever of white or
// navy reads better on it. `css` (inline, so it beats every class rule) is the
// free-form one, and wins over `background` where they overlap.
export function noticeStyle(notice) {
  const style = {};
  if (notice.background) {
    const background = notice.background;
    style["--notice-bg"] = background;
    style["--notice-fg"] =
      contrast(background, WHITE) >= contrast(background, NAVY) ? WHITE : NAVY;
    style["--notice-link"] = "currentColor";
  }
  if (notice.css) Object.assign(style, parseCss(notice.css));
  return Object.keys(style).length ? style : undefined;
}

export function useNotices() {
  const [notices, setNotices] = useState([]);
  const [dismissed, setDismissed] = usePersistentState("dismissedNotices", []);

  useEffect(() => {
    let cancelled = false;
    fetch(NOTICES_URL)
      .then((response) => (response.ok ? response.json() : []))
      .then((raw) => {
        if (!cancelled) setNotices(parseNotices(raw));
      })
      .catch((error) => console.error("could not load notices:", error));
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    notices,
    undismissed: notices.filter(({ id }) => !dismissed.includes(id)),
    dismiss: (id) => setDismissed((ids) => [...ids, id]),
  };
}
