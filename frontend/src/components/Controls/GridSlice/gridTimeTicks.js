// Tick labels for a single gridded dataset's own time axis.
//
// The bottom bar's main axis is the whole catalogue's, warped around the eras
// the records sit in, and its labels are always years (see timeAxis.js). This
// axis is one dataset's, unwarped, and can span anything from a few hours of a
// forecast to a century of a reanalysis — so neither the step nor the label
// format can be fixed in advance. Both are chosen from the span and from how
// much room the rail actually has, the way the year labels are.
//
// Candidates run from the finest step to the coarsest and the first one that
// fits wins, so the rail is labelled as densely as it can be read.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function pad (value) {
  return String(value).padStart(2, '0')
}

// Steps are calendar-aligned rather than laid out from the axis start: a label
// row reading 01-01, 01-06, 01-11 says "every five days" at a glance, where one
// reading 01-03, 01-08, 01-13 asks to be worked out. Months and years are
// counted in months (they are not a fixed number of milliseconds); hours and
// days step in plain time, from the epoch, which lands them on midnight and on
// the round hours.
const TICK_UNITS = [
  {
    unit: 'hour',
    multiples: [1, 3, 6, 12],
    // The pitch each label needs: its own width at the tick row's size, plus
    // room to breathe on both sides.
    gapPx: 48,
    // Midnight is named by its date rather than by four zeros: a row of clock
    // times across several days says when but never which day, and the day
    // boundaries are exactly where that question comes up.
    format: (date) =>
      date.getUTCHours() === 0 && date.getUTCMinutes() === 0
        ? `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
        : `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  },
  {
    unit: 'day',
    multiples: [1, 2, 5, 10],
    gapPx: 48,
    format: (date) => `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  },
  {
    unit: 'month',
    multiples: [1, 3, 6],
    gapPx: 60,
    format: (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
  },
  {
    unit: 'year',
    multiples: [1, 2, 5, 10, 25, 50, 100],
    gapPx: 42,
    format: (date) => String(date.getUTCFullYear())
  }
]

function ticksAt (minMs, maxMs, unit, multiple) {
  const values = []
  if (unit === 'month' || unit === 'year') {
    const monthsPerStep = unit === 'year' ? multiple * 12 : multiple
    const start = new Date(minMs)
    const firstMonth =
      Math.ceil(
        (start.getUTCFullYear() * 12 + start.getUTCMonth()) / monthsPerStep
      ) * monthsPerStep
    for (let month = firstMonth; ; month += monthsPerStep) {
      const ms = Date.UTC(Math.floor(month / 12), month % 12, 1)
      if (ms > maxMs) break
      if (ms >= minMs) values.push(ms)
    }
  } else {
    const step = (unit === 'day' ? DAY : HOUR) * multiple
    for (let ms = Math.ceil(minMs / step) * step; ms <= maxMs; ms += step) {
      values.push(ms)
    }
  }
  return values
}

// The last resort, for a span too short to hold two round instants of any size
// — a grid of a handful of hourly slices, say. Its two ends are then the only
// honest labels there are, and they carry the clock as well as the date.
function endpointTicks (minMs, maxMs) {
  return [minMs, maxMs].map((ms) => {
    const date = new Date(ms)
    return {
      key: ms,
      value: ms,
      label: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
    }
  })
}

function labelled (values, format) {
  return values.map((ms) => ({
    key: ms,
    value: ms,
    label: format(new Date(ms))
  }))
}

export default function gridTimeTicks (railLength, minMs, maxMs) {
  if (!railLength || !(maxMs > minMs)) return []

  // The finest step tried so far that the rail is too narrow for. Kept because
  // the loop may run out of steps before one fits — on a rail that narrow,
  // crowded labels still beat none.
  let densest = null
  for (const { unit, multiples, gapPx, format } of TICK_UNITS) {
    for (const multiple of multiples) {
      const values = ticksAt(minMs, maxMs, unit, multiple)
      // Coarser candidates only ever hold fewer, so once a step has stopped
      // landing inside the span twice there is nothing left to try.
      if (values.length < 2) return densest || endpointTicks(minMs, maxMs)
      if (values.length <= Math.floor(railLength / gapPx)) {
        return labelled(values, format)
      }
      densest = labelled(values, format)
    }
  }
  return densest
}
