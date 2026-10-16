// A dataset's own axis spans hours to a century, so step and label format are
// both picked from the span and the rail's room: finest fitting step wins.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function pad(value) {
  return String(value).padStart(2, "0");
}

// Calendar-aligned (01-01, 01-06, 01-11), not laid out from the axis start.
// Months/years step in months since they aren't a fixed number of ms.
const TICK_UNITS = [
  {
    unit: "hour",
    multiples: [1, 3, 6, 12],
    gapPx: 48,
    // Midnight shows the date, so a multi-day row says which day.
    format: (date) =>
      date.getUTCHours() === 0 && date.getUTCMinutes() === 0
        ? `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
        : `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
  },
  {
    unit: "day",
    multiples: [1, 2, 5, 10],
    gapPx: 48,
    format: (date) =>
      `${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
  },
  {
    unit: "month",
    multiples: [1, 3, 6],
    gapPx: 60,
    format: (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`,
  },
  {
    unit: "year",
    multiples: [1, 2, 5, 10, 25, 50, 100],
    gapPx: 42,
    format: (date) => String(date.getUTCFullYear()),
  },
];

function ticksAt(minMs, maxMs, unit, multiple) {
  const values = [];
  if (unit === "month" || unit === "year") {
    const monthsPerStep = unit === "year" ? multiple * 12 : multiple;
    const start = new Date(minMs);
    const firstMonth =
      Math.ceil(
        (start.getUTCFullYear() * 12 + start.getUTCMonth()) / monthsPerStep,
      ) * monthsPerStep;
    for (let month = firstMonth; ; month += monthsPerStep) {
      const ms = Date.UTC(Math.floor(month / 12), month % 12, 1);
      if (ms > maxMs) break;
      if (ms >= minMs) values.push(ms);
    }
  } else {
    const step = (unit === "day" ? DAY : HOUR) * multiple;
    for (let ms = Math.ceil(minMs / step) * step; ms <= maxMs; ms += step) {
      values.push(ms);
    }
  }
  return values;
}

// For spans too short to hold two round instants of any step.
function endpointTicks(minMs, maxMs) {
  return [minMs, maxMs].map((ms) => {
    const date = new Date(ms);
    return {
      key: ms,
      value: ms,
      label: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    };
  });
}

function labelled(values, format) {
  return values.map((ms) => ({
    key: ms,
    value: ms,
    label: format(new Date(ms)),
  }));
}

export default function gridTimeTicks(railLength, minMs, maxMs) {
  if (!railLength || !(maxMs > minMs)) return [];

  // On a rail too narrow for any step, crowded labels still beat none.
  let densest = null;
  for (const { unit, multiples, gapPx, format } of TICK_UNITS) {
    for (const multiple of multiples) {
      const values = ticksAt(minMs, maxMs, unit, multiple);
      // Coarser candidates only ever hold fewer.
      if (values.length < 2) return densest || endpointTicks(minMs, maxMs);
      if (values.length <= Math.floor(railLength / gapPx)) {
        return labelled(values, format);
      }
      densest = labelled(values, format);
    }
  }
  return densest;
}
