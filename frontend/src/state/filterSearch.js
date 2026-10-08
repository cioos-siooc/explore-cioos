import Fuse from "fuse.js";
import deburr from "lodash-es/deburr";

import { aliasVariants } from "./searchAliases.js";
import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../components/config.js";

// Typo-tolerant, and blind to case and accents, so "temprature" finds
// "Température" and the French facet labels are as reachable as the English
// ones. ignoreLocation, as a dataset title names its subject anywhere in it.
// Aliases too, so "otn" finds "Ocean Tracking Network".
const FUSE_OPTIONS = {
  keys: [
    {
      name: "text",
      getFn: (option) =>
        aliasVariants(option.matchText ?? option.label).join(" "),
    },
  ],
  ignoreDiacritics: true,
  ignoreLocation: true,
};

// A leading "-", "not" or "sauf" asks for the value to be excluded rather than
// included, the same include / exclude pair every list filter offers. The
// words need a space after them, so "nothing" or "saufen" stay searches.
const EXCLUDE_PREFIX = /^(?:-|(?:not|sauf)\s+)\s*/i;

export function parseFilterQuery(text) {
  const trimmed = text.trim();
  const exclude = EXCLUDE_PREFIX.test(trimmed);
  return { term: trimmed.replace(EXCLUDE_PREFIX, "").trim(), exclude };
}

// groups: [{ key, options: [{ label, matchText?, state, ... }] }]. With no term, the
// options already applied, so the bar doubles as the list to remove them from
// (plus any `keep(groupKey, option)` names, so one just removed stays listed);
// otherwise the options that match the term, closest first. A shortcut is
// never listed as applied: the options it set are.
export function matchFilterOptions(
  groups,
  term,
  limit = 5,
  keep = () => false,
) {
  const needle = term.trim();
  // A typo in a short word leaves too little of it to go on: "DFO" one letter
  // off matches half the catalogue. Short terms match near exactly, and the
  // tolerance grows with the term.
  const looseness = needle.length <= 3 ? 0.1 : needle.length <= 5 ? 0.25 : 0.35;
  return groups
    .map((group) => ({
      ...group,
      options: needle
        ? new Fuse(group.options, { ...FUSE_OPTIONS, threshold: looseness })
            .search(needle, { limit })
            .map(({ item }) => item)
        : group.options.filter(
            (o) => (o.state && !o.shortcut) || keep(group.key, o),
          ),
    }))
    .filter((group) => group.options.length > 0);
}

// Matched against deburred text, so the French words are spelled unaccented
// here and match whether or not they were typed with their accents.
const LEAD = String.raw`(?:(?:from|between|since|after|starting(?: from)?|de|du|entre|depuis|apres|a partir de)\s+)?`;
const TO = String.raw`(?:\s*(?:\.\.|–|—|-)\s*|\s+(?:to|and|until|till|through|thru|a|au|et|jusqu'a|jusqu'au)\s+)`;
const AFTER = String.raw`(?:since|after|from|starting(?: from)?|depuis|apres|a partir de|>=?)\s*`;
const BEFORE = String.raw`(?:before|until|till|up to|to|through|avant|jusqu'a|jusqu'au|<=?)\s*`;
const DURING = String.raw`(?:(?:in|during|en|pendant|durant)\s+)?`;
// A year, a year and month, or a full date, with "-", "/" or "." between the
// parts; or the present, which can only close a range. With "-" the month and
// day take two digits, so "2010-2" is a range being typed, not February.
const DATE = String.raw`(\d{4}(?:-\d{2}(?:-\d{2})?|[/.]\d{1,2}(?:[/.]\d{1,2})?)?)`;
const UNIT = String.raw`(days?|weeks?|months?|years?|yrs?|mos?|d|w|y|jours?|semaines?|mois|ans?|annees?)`;
const UNIT_WORDS = [
  "days",
  "weeks",
  "months",
  "years",
  "jours",
  "semaines",
  "mois",
  "ans",
  "annees",
];
// Depth reads downwards: "above" a depth is shallower than it, "below" it is
// deeper. "under"/"over" are left out, as they could mean either.
const LESS = String.raw`<=?|less than|above|shallower than|moins de|au-dessus de|moins profond que`;
const MORE = String.raw`>=?|more than|below|deeper than|plus de|en[- ]?dessous de|au-dessous de|sous|plus profond que`;

const pad = (n) => String(n).padStart(2, "0");

const unitOf = (word) =>
  /^(?:d|j)/.test(word)
    ? "day"
    : /^(?:w|s)/.test(word)
      ? "week"
      : /^mo/.test(word)
        ? "month"
        : "year";

// The day n units before an ISO date. A month or year back from the 31st
// lands on the last day of a shorter month rather than spilling past it.
function shiftBack(iso, n, unit) {
  const [year, month, day] = iso.split("-").map(Number);
  if (unit === "day" || unit === "week") {
    const back = n * (unit === "week" ? 7 : 1);
    return new Date(Date.UTC(year, month - 1, day - back))
      .toISOString()
      .slice(0, 10);
  }
  const total = year * 12 + month - 1 - n * (unit === "year" ? 12 : 1);
  const [y, m] = [Math.floor(total / 12), (total % 12) + 1];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(day, lastDay))}`;
}

// "last 3 months", "past week", "2 years ago", "les 3 derniers mois", "le mois
// dernier", "depuis 2 ans": a span counted back from today, up to today.
// Rolling, so "last year" is the past twelve months, not the calendar year.
const RELATIVE_SPANS = [
  [
    String.raw`^(?:(?:in|over|within|for|during|since)\s+)?(?:the\s+)?(last|past|previous)?\s*(\d+)?\s*${UNIT}(?:\s+ago)?$`,
    ([, last, n, unit]) => (last || n) && [Number(n ?? 1), unit],
  ],
  [
    String.raw`^(?:(?:dans|depuis|durant|pendant|au cours)\s+)?(?:(?:les|la|le|des|du)\s+|l')?(?:(\d+)\s+)?dernier(?:e|s|es)?\s+${UNIT}$`,
    ([, n, unit]) => [Number(n ?? 1), unit],
  ],
  [
    String.raw`^(?:le\s+|la\s+|l')${UNIT}\s+dernier(?:e)?$`,
    ([, unit]) => [1, unit],
  ],
  [
    String.raw`^(?:depuis|il y a)\s+(\d+)\s*${UNIT}$`,
    ([, n, unit]) => [Number(n), unit],
  ],
].map(([pattern, read]) => [new RegExp(pattern), read]);

// The same references as points in time, so they can open or close a range:
// "since 3 months ago", "from last year to last month", "2020 to yesterday".
function relativeDates(text, today) {
  const back = (n, unit) => shiftBack(today, Number(n), unitOf(unit));
  return text
    .replace(
      new RegExp(String.raw`\b(\d+)\s*${UNIT}\s+ago\b`, "g"),
      (_, n, u) => back(n, u),
    )
    .replace(
      new RegExp(String.raw`\bil y a\s+(\d+)\s*${UNIT}\b`, "g"),
      (_, n, u) => back(n, u),
    )
    .replace(
      new RegExp(String.raw`\b(?:last|past|previous)\s+${UNIT}\b`, "g"),
      (_, u) => back(1, u),
    )
    .replace(/\b(?:yesterday|hier)\b/g, () => back(1, "day"))
    .replace(/\b(?:today|now|present|maintenant)\b|\baujourd'hui\b/g, today);
}

// The first and last day a typed date covers: a whole year, a whole month, or
// the one day. undefined for a month or day that does not exist.
function dateSpan(token) {
  const [year, month, day] = token.split(/[-/.]/).map(Number);
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  if (month === undefined) return [`${year}-01-01`, `${year}-12-31`];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day === undefined)
    return [`${year}-${pad(month)}-01`, `${year}-${pad(month)}-${lastDay}`];
  if (day < 1 || day > lastDay) return undefined;
  const iso = `${year}-${pad(month)}-${pad(day)}`;
  return [iso, iso];
}

const clamp = (value, min, max) =>
  value < min ? min : value > max ? max : value;

const rangeText = (term) =>
  deburr(term).trim().toLowerCase().replace(/[‘’]/g, "'");

const DEFAULT_BOUNDS = {
  minDate: defaultStartDate,
  maxDate: defaultEndDate,
  minDepth: defaultStartDepth,
  maxDepth: defaultEndDepth,
};

// Typed time or depth ranges, as the values the time and depth filters hold:
// `{ key: "time", start, end }` in ISO dates, `{ key: "depth", start, end }`
// in metres. Depth needs its unit or a "depth" prefix, or "2010-2020" would
// read as either. undefined when the term is neither.
export function parseRangeQuery(term, bounds = DEFAULT_BOUNDS) {
  const text = rangeText(term);

  const depth = text.match(
    new RegExp(
      String.raw`^(?:(depth|profondeur)\s*)?(?:(?:(${LESS})|(${MORE}))\s*)?${LEAD}(\d+)\s*(?:m\b)?(?:${TO}(\d+))?\s*m?$`,
    ),
  );
  if (depth && (depth[1] || /\d\s*m\b/.test(text))) {
    const [, , , more, a, b] = depth;
    const n = (v) => clamp(Number(v), bounds.minDepth, bounds.maxDepth);
    let range;
    if (b !== undefined) range = n(a) <= n(b) ? [n(a), n(b)] : [n(b), n(a)];
    else if (more) range = [n(a), bounds.maxDepth];
    else range = [bounds.minDepth, n(a)];
    return { key: "depth", start: range[0], end: range[1] };
  }

  const d = (v) => clamp(v, bounds.minDate, bounds.maxDate);
  const time = (start, end) =>
    start && end ? { key: "time", start: d(start), end: d(end) } : undefined;
  for (const [pattern, read] of RELATIVE_SPANS) {
    const span = text.match(pattern) && read(text.match(pattern));
    if (span)
      return time(
        shiftBack(bounds.maxDate, span[0], unitOf(span[1])),
        bounds.maxDate,
      );
  }
  const dated = relativeDates(text, bounds.maxDate);
  let m;
  if ((m = dated.match(new RegExp(`^${LEAD}${DATE}${TO}${DATE}$`)))) {
    const first = dateSpan(m[1]);
    const last = dateSpan(m[2]);
    if (!first || !last) return undefined;
    const [a, b] = first[0] <= last[0] ? [first, last] : [last, first];
    return time(a[0], b[1]);
  }
  if ((m = dated.match(new RegExp(`^${AFTER}${DATE}$`))))
    return time(dateSpan(m[1])?.[0], bounds.maxDate);
  if ((m = dated.match(new RegExp(`^${BEFORE}${DATE}$`))))
    return time(bounds.minDate, dateSpan(m[1])?.[1]);
  if ((m = dated.match(new RegExp(`^${DURING}${DATE}$`))))
    return time(...(dateSpan(m[1]) ?? []));
  return undefined;
}

const CONNECTORS = [
  "to",
  "and",
  "until",
  "till",
  "through",
  "thru",
  "a",
  "au",
  "et",
  "jusqu'a",
  "jusqu'au",
];

// What can be left half-typed at the end of a time range: digits and date
// punctuation, or the start of a connecting word.
const isUnfinished = (tail) =>
  /^[\d\-–—./]*$/.test(tail) ||
  CONNECTORS.some((word) => word.startsWith(tail));

// parseRangeQuery, but with an answer while the range is still being typed:
// an unfinished date or connecting word at the end is dropped and the rest
// read on its own, so "from 2022 to 20" already offers 2022 onwards, and the
// suggestion tightens as the second date is completed. Time only: a depth
// reads as one only once its unit is there, which is typed last.
export function parsePartialRangeQuery(term, bounds = DEFAULT_BOUNDS) {
  const full = parseRangeQuery(term, bounds);
  if (full) return full;
  // Without its second date, "between 2010" says what "from 2010" does.
  const opened = (text) => text.replace(/^(?:between|entre|de|du)\b/, "from");
  let text = rangeText(term);
  for (let dropped = 0; dropped < 4; dropped++) {
    const partial = parseRangeQuery(opened(text), bounds);
    if (partial?.key === "time") return partial;
    // A unit half typed: "last 3 mon" reads as "last 3 months".
    const tail = text.match(/(\S+)$/)?.[1];
    for (const word of [...UNIT_WORDS, "ago", "dernier", "derniere"]) {
      if (!tail || !word.startsWith(tail) || word === tail) continue;
      const completed = parseRangeQuery(
        opened(text.replace(/\S+$/, word)),
        bounds,
      );
      if (completed?.key === "time") return completed;
    }
    // The shortest unfinished ending: "-0" off "2015-0", not all of it.
    const m = text.match(/^(.*)(\s*[-–—./]+\d{0,3}|\s+\S+)$/);
    if (!m || !isUnfinished(m[2].trim())) return undefined;
    text = m[1];
  }
  return undefined;
}
