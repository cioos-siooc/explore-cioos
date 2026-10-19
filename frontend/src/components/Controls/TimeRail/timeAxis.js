// Piecewise-linear: almost every record is post-2000, so a linear 1900→today
// axis would spend ~80% of the width on a few historical series. Both
// directions must stay monotonic so toMs()/toPos() round-trip.

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// [date, fraction of the axis width]; stops outside the domain are dropped.
const AXIS_STOPS = [
  ["1950-01-01", 0.05],
  ["1980-01-01", 0.12],
  ["2000-01-01", 0.27],
];

export function isoToMs(iso) {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

export function msToIso(ms) {
  return new Date(ms).toISOString().split("T")[0];
}

export function todayIso() {
  return new Date().toISOString().split("T")[0];
}

// Tile requests key off the date string; unsnapped, a drag would create a new
// cache entry every animation frame.
export function snapToDay(ms) {
  return Math.round(ms / MS_PER_DAY) * MS_PER_DAY;
}

export function clampIso(iso, minIso, maxIso) {
  if (minIso && iso < minIso) return minIso;
  if (maxIso && iso > maxIso) return maxIso;
  return iso;
}

function lerp(value, [inMin, inMax], [outMin, outMax]) {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function createTimeAxis(minIso, maxIso) {
  const minMs = isoToMs(minIso);
  const maxMs = isoToMs(maxIso);

  const anchors = [
    [minMs, 0],
    ...AXIS_STOPS.map(([iso, pos]) => [isoToMs(iso), pos]).filter(
      ([ms]) => ms > minMs && ms < maxMs,
    ),
    [maxMs, 1],
  ];

  function toPos(ms) {
    if (ms <= minMs) return 0;
    if (ms >= maxMs) return 1;
    for (let i = 1; i < anchors.length; i++) {
      if (ms <= anchors[i][0]) {
        return lerp(
          ms,
          [anchors[i - 1][0], anchors[i][0]],
          [anchors[i - 1][1], anchors[i][1]],
        );
      }
    }
    return 1;
  }

  function toMs(pos) {
    if (pos <= 0) return minMs;
    if (pos >= 1) return maxMs;
    for (let i = 1; i < anchors.length; i++) {
      if (pos <= anchors[i][1]) {
        return lerp(
          pos,
          [anchors[i - 1][1], anchors[i][1]],
          [anchors[i - 1][0], anchors[i][0]],
        );
      }
    }
    return maxMs;
  }

  const anchorYears = anchors.map(([ms]) => new Date(ms).getUTCFullYear());

  return { minMs, maxMs, minIso, maxIso, anchorYears, toPos, toMs };
}

// The warped axis gives equal calendar spans unequal room, so ticks are picked
// by measured pixel room: era anchors first (they explain the warp), then round
// years between the survivors.

// A four-digit year at 10px is ~26px, plus breathing room.
const MIN_TICK_GAP_PX = 42;

// Round decades read as time; 2-year and 25-year steps read as arithmetic.
const TICK_STEPS = [1, 5, 10, 25, 50, 100];

function subdivide(fromYear, toYear, room) {
  const span = toYear - fromYear;
  const step = TICK_STEPS.find((candidate) => span / candidate <= room);
  if (!step || step >= span) return [];
  const years = [];
  for (
    let year = Math.ceil((fromYear + 1) / step) * step;
    year < toYear;
    year += step
  ) {
    years.push(year);
  }
  return years;
}

export function tickYearsFor(railWidth, anchorYears, toPos) {
  if (!railWidth) return [];
  const minGap = MIN_TICK_GAP_PX / railWidth;
  const posOf = (year) => toPos(isoToMs(`${year}-01-01`));

  const kept = [];
  anchorYears.forEach((year) => {
    if (!kept.length || posOf(year) - posOf(kept[kept.length - 1]) >= minGap) {
      kept.push(year);
    }
  });

  const years = [];
  kept.forEach((year, index) => {
    years.push(year);
    const next = kept[index + 1];
    if (next == null) return;
    const room = Math.floor((posOf(next) - posOf(year)) / minGap) - 1;
    if (room > 0) {
      subdivide(year, next, room).forEach((filler) => {
        const last = years[years.length - 1];
        if (
          posOf(filler) - posOf(last) >= minGap &&
          posOf(next) - posOf(filler) >= minGap
        ) {
          years.push(filler);
        }
      });
    }
  });
  return years;
}
