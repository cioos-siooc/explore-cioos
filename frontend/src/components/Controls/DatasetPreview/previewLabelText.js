// Fitting label text to a known width: how many characters fit, and where to
// break when they do not.
//
// Plotly is told every font size explicitly rather than left to its own
// defaults, because these estimates assume the size that is actually rendered.

// Every label is drawn at this size explicitly, rather than at Plotly's default
// for an axis title — bigFont(layout.font.size) = round(1.2 * 12) = 14. Being
// explicit is what lets maxCharsFor predict how wide a label will render, and 12
// matches the tick labels.
export const LABEL_FONT_PX = 12;
export const TITLE_FONT_PX = 14;
export const MAX_TITLE_LINES = 2;

// Average advance per character for Plotly's default stack ("Open Sans,
// verdana, arial, sans-serif"), as a fraction of the font size. Deliberately
// generous: overestimating wraps a label one word early, underestimating puts
// two panel titles on top of each other.
const CHAR_PX_PER_FONT_PX = 0.58;
const MAX_LABEL_LINES = 3;

// labelFor writes "long_name ( unit )", and the unit group is both the tail of
// every label and the part that collides first, so it gets its own line.
const UNIT_SUFFIX = /\s\(\s[^()]*\s\)$/;

// 0 means "unknown" — buildFigure is called before the plot area has been
// measured, and every caller treats 0 as "do not wrap" rather than wrapping
// against a guessed width.
export function maxCharsFor(widthPx, fontPx = LABEL_FONT_PX) {
  if (!widthPx || widthPx <= 0) return 0;
  return Math.max(8, Math.floor(widthPx / (fontPx * CHAR_PX_PER_FONT_PX)));
}

function greedyLines(text, maxChars) {
  const lines = [];
  let current = "";
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word) => {
      if (!current) {
        current = word;
      } else if (`${current} ${word}`.length <= maxChars) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        current = word;
      }
    });
  if (current) lines.push(current);
  return lines;
}

export function ellipsize(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

/**
 * Break a label onto as many lines as it needs, with <br> — what Plotly reads
 * inside a title or an annotation, and what it counts when growing a margin.
 *
 * A word is never split: a single long token overflows its panel slightly
 * rather than being mangled. Past `maxLines` the NAME is truncated and the unit
 * line is always kept — a label whose unit went missing reads as a different
 * quantity.
 */
export function wrapLabel(text, maxChars, maxLines = MAX_LABEL_LINES) {
  const label = (text || "").trim();
  if (!maxChars || label.length <= maxChars) return label;

  const match = label.match(UNIT_SUFFIX);
  const unit = match ? match[0].trim() : "";
  const name = match ? label.slice(0, match.index).trim() : label;

  const allowed = Math.max(1, maxLines - (unit ? 1 : 0));
  let lines = greedyLines(name, maxChars);
  if (!lines.length) lines = [""];
  if (lines.length > allowed) {
    const kept = lines.slice(0, allowed - 1);
    kept.push(ellipsize(lines.slice(allowed - 1).join(" "), maxChars));
    lines = kept;
  }
  return [...lines, ...(unit ? [unit] : [])].join("<br>");
}

// The title wraps against the whole figure width, not a panel: it is centred on
// the figure, not on anything inside it.
export function wrapTitleFor(title, widthPx) {
  return wrapLabel(title, maxCharsFor(widthPx, TITLE_FONT_PX), MAX_TITLE_LINES);
}

export function titleLinesFor(title, widthPx) {
  const wrapped = wrapTitleFor(title, widthPx);
  return wrapped ? wrapped.split("<br>").length : 0;
}
