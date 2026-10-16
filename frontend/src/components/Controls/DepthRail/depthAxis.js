// Piecewise-linear: the domain is 0–12000 m but nearly every record is in the
// top few hundred metres, which a linear axis would squeeze into the first
// centimetre. Both directions must stay monotonic so toValue()/toPos()
// round-trip.

// [metres, fraction of the axis width]; stops outside the domain are dropped.
const AXIS_STOPS = [
  [100, 0.22],
  [500, 0.42],
  [1000, 0.55],
  [4000, 0.8],
];

const TICK_FILLERS = [
  25, 50, 200, 250, 750, 1500, 2000, 3000, 5000, 6000, 8000, 10000,
];

// Across: a five-digit label at 11px (~34px) plus room. Down: only line height
// has to clear.
export const MIN_TICK_GAP_PX = 46;
export const MIN_TICK_GAP_PX_VERTICAL = 16;

// Fractional metres from a drag would key a new request every animation frame.
export function snapToMetre(depth) {
  return Math.round(depth);
}

export function clampDepth(depth, min, max) {
  if (Number.isNaN(depth)) return min;
  return Math.min(Math.max(depth, min), max);
}

function lerp(value, [inMin, inMax], [outMin, outMax]) {
  if (inMax === inMin) return outMin;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

export function createDepthAxis(min, max) {
  const anchors = [
    [min, 0],
    ...AXIS_STOPS.filter(([depth]) => depth > min && depth < max),
    [max, 1],
  ];

  function toPos(depth) {
    if (depth <= min) return 0;
    if (depth >= max) return 1;
    for (let i = 1; i < anchors.length; i++) {
      if (depth <= anchors[i][0]) {
        return lerp(
          depth,
          [anchors[i - 1][0], anchors[i][0]],
          [anchors[i - 1][1], anchors[i][1]],
        );
      }
    }
    return 1;
  }

  function toValue(pos) {
    if (pos <= 0) return min;
    if (pos >= 1) return max;
    for (let i = 1; i < anchors.length; i++) {
      if (pos <= anchors[i][1]) {
        return lerp(
          pos,
          [anchors[i - 1][1], anchors[i][1]],
          [anchors[i - 1][0], anchors[i][0]],
        );
      }
    }
    return max;
  }

  return {
    min,
    max,
    toPos,
    toValue,
    anchorDepths: anchors.map(([depth]) => depth),
  };
}

// Same two-pass pixel-room scheme as tickYearsFor: anchors first, then fillers.
export function tickDepthsFor(
  railLength,
  anchorDepths,
  toPos,
  minGapPx = MIN_TICK_GAP_PX,
) {
  if (!railLength) return [];
  const minGap = minGapPx / railLength;

  const kept = [];
  anchorDepths.forEach((depth) => {
    if (!kept.length || toPos(depth) - toPos(kept[kept.length - 1]) >= minGap) {
      kept.push(depth);
    }
  });

  const depths = [];
  kept.forEach((depth, index) => {
    depths.push(depth);
    const next = kept[index + 1];
    if (next == null) return;
    TICK_FILLERS.filter((filler) => filler > depth && filler < next).forEach(
      (filler) => {
        const last = depths[depths.length - 1];
        if (
          toPos(filler) - toPos(last) >= minGap &&
          toPos(next) - toPos(filler) >= minGap
        ) {
          depths.push(filler);
        }
      },
    );
  });
  return depths;
}
