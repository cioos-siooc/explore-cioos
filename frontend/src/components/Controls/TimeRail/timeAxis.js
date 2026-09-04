// The warped time axis shared by everything on the bottom time bar.
//
// The bar spans the whole filterable domain (1900 → today) but the catalogue
// does not: almost every record sits after 2000, and the pre-2000 tail is a
// handful of long historical series. On a linear axis that puts ~80% of the
// width where there is nothing to pick, and squeezes the years people actually
// scrub through into the last fifth. So the axis is piecewise-linear: the
// stops below hand each era a fixed slice of the width, with the 20th century
// compressed into the first quarter and 2000-onward given the rest.
//
// Both directions stay monotonic, so a handle dragged right never moves back
// in time, and every position round-trips through toMs()/toPos().

export const MS_PER_DAY = 24 * 60 * 60 * 1000

// [date, fraction of the axis width at that date]. The domain ends (min → 0,
// max → 1) are added by createTimeAxis; anything here that falls outside the
// domain is dropped, so the axis still works if the domain is narrowed.
const AXIS_STOPS = [
  ['1950-01-01', 0.05],
  ['1980-01-01', 0.12],
  ['2000-01-01', 0.27]
]

export function isoToMs (iso) {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

export function msToIso (ms) {
  return new Date(ms).toISOString().split('T')[0]
}

export function todayIso () {
  return new Date().toISOString().split('T')[0]
}

// Whole UTC days only: the tile requests key off the date string, so snapping
// keeps a drag from generating a new cache entry every animation frame.
export function snapToDay (ms) {
  return Math.round(ms / MS_PER_DAY) * MS_PER_DAY
}

export function clampIso (iso, minIso, maxIso) {
  if (minIso && iso < minIso) return minIso
  if (maxIso && iso > maxIso) return maxIso
  return iso
}

function lerp (value, [inMin, inMax], [outMin, outMax]) {
  if (inMax === inMin) return outMin
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin)
}

export function createTimeAxis (minIso, maxIso) {
  const minMs = isoToMs(minIso)
  const maxMs = isoToMs(maxIso)

  const anchors = [
    [minMs, 0],
    ...AXIS_STOPS.map(([iso, pos]) => [isoToMs(iso), pos]).filter(
      ([ms]) => ms > minMs && ms < maxMs
    ),
    [maxMs, 1]
  ]

  // ms → 0..1 along the bar.
  function toPos (ms) {
    if (ms <= minMs) return 0
    if (ms >= maxMs) return 1
    for (let i = 1; i < anchors.length; i++) {
      if (ms <= anchors[i][0]) {
        return lerp(
          ms,
          [anchors[i - 1][0], anchors[i][0]],
          [anchors[i - 1][1], anchors[i][1]]
        )
      }
    }
    return 1
  }

  // 0..1 along the bar → ms.
  function toMs (pos) {
    if (pos <= 0) return minMs
    if (pos >= 1) return maxMs
    for (let i = 1; i < anchors.length; i++) {
      if (pos <= anchors[i][1]) {
        return lerp(
          pos,
          [anchors[i - 1][1], anchors[i][1]],
          [anchors[i - 1][0], anchors[i][0]]
        )
      }
    }
    return maxMs
  }

  // The era boundaries, as years — the labels that explain the warp, and the
  // ones tickYearsFor gives first refusal to.
  const anchorYears = anchors.map(([ms]) => new Date(ms).getUTCFullYear())

  return { minMs, maxMs, minIso, maxIso, anchorYears, toPos, toMs }
}

// Year labels under the rail.
//
// A fixed set of years can't work here: the axis is warped, so equal spans of
// calendar time get wildly unequal amounts of rail, and the bar is a wide
// bubble on desktop but edge-to-edge on a phone. Labels are therefore chosen
// by how much room they actually get — measured in pixels off the same toPos
// the handles use, so what is drawn is what fits.
//
// Two passes. The anchor years (the era boundaries the warp is built around)
// get first refusal, because they are the ones that explain the axis; the
// spans between whichever of them survived are then subdivided at a round step
// with whatever room is left.

// Label pitch: a four-digit year at the tick row's 10px size (~26px) plus
// breathing room on both sides.
const MIN_TICK_GAP_PX = 42

// Round decades read as time; 2-year and 25-year steps read as arithmetic.
const TICK_STEPS = [1, 5, 10, 25, 50, 100]

function subdivide (fromYear, toYear, room) {
  const span = toYear - fromYear
  const step = TICK_STEPS.find((candidate) => span / candidate <= room)
  if (!step || step >= span) return []
  const years = []
  // Round steps land on round years — 1985, not 1983 — which means the first
  // one may sit further in than `step` from the segment start.
  for (
    let year = Math.ceil((fromYear + 1) / step) * step;
    year < toYear;
    year += step
  ) {
    years.push(year)
  }
  return years
}

export function tickYearsFor (railWidth, anchorYears, toPos) {
  if (!railWidth) return []
  const minGap = MIN_TICK_GAP_PX / railWidth
  const posOf = (year) => toPos(isoToMs(`${year}-01-01`))

  // Pass one: era boundaries, left to right, each kept only if it clears the
  // last one kept. The first (the domain start) is never dropped.
  const kept = []
  anchorYears.forEach((year) => {
    if (!kept.length || posOf(year) - posOf(kept[kept.length - 1]) >= minGap) {
      kept.push(year)
    }
  })

  // Pass two: fill each surviving span with as many round years as it holds.
  const years = []
  kept.forEach((year, index) => {
    years.push(year)
    const next = kept[index + 1]
    if (next == null) return
    const room = Math.floor((posOf(next) - posOf(year)) / minGap) - 1
    if (room > 0) {
      subdivide(year, next, room).forEach((filler) => {
        const last = years[years.length - 1]
        if (
          posOf(filler) - posOf(last) >= minGap &&
          posOf(next) - posOf(filler) >= minGap
        ) {
          years.push(filler)
        }
      })
    }
  })
  return years
}
