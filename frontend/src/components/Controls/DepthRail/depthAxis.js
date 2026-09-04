// The warped depth axis, the water column's answer to the time axis next to it
// in the Filters panel.
//
// The filter spans 0–12000 m because the deepest trench does, but the
// catalogue does not: nearly everything measured sits in the top few hundred
// metres, and below ~1000 m the records are a thin scattering of moorings,
// floats and casts. On a linear axis that leaves the depths people actually
// pick squeezed into the first centimetre of the rail. So the axis is
// piecewise-linear, like the time one: the stops below hand each layer a fixed
// slice of the width, with the sunlit top 100 m given a fifth of the rail and
// everything past 4000 m sharing the last fifth.
//
// Both directions stay monotonic, so a handle dragged right never moves
// shallower, and every position round-trips through toValue()/toPos().

// [metres, fraction of the axis width at that depth]. The domain ends
// (min → 0, max → 1) are added by createDepthAxis; anything here outside the
// domain is dropped, so the axis still works if the domain is narrowed.
const AXIS_STOPS = [
  [100, 0.22],
  [500, 0.42],
  [1000, 0.55],
  [4000, 0.8]
]

// Depths worth a label if the rail has room between the stops above, which get
// first refusal because they are what explains the warp.
const TICK_FILLERS = [
  25, 50, 200, 250, 750, 1500, 2000, 3000, 5000, 6000, 8000, 10000
]

// Label pitch across: a five-digit metre count at the tick row's 11px size
// (~34px) plus breathing room on both sides. Down the rail the labels stack
// instead, so what has to clear is their line height, not their width — which
// is why the vertical rail can afford several times as many.
export const MIN_TICK_GAP_PX = 46
export const MIN_TICK_GAP_PX_VERTICAL = 16

// Whole metres only: the depth filter is a query parameter, and a drag that
// generated fractional metres would key a new request every animation frame.
export function snapToMetre (depth) {
  return Math.round(depth)
}

export function clampDepth (depth, min, max) {
  if (Number.isNaN(depth)) return min
  return Math.min(Math.max(depth, min), max)
}

function lerp (value, [inMin, inMax], [outMin, outMax]) {
  if (inMax === inMin) return outMin
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin)
}

export function createDepthAxis (min, max) {
  const anchors = [
    [min, 0],
    ...AXIS_STOPS.filter(([depth]) => depth > min && depth < max),
    [max, 1]
  ]

  // metres → 0..1 along the rail.
  function toPos (depth) {
    if (depth <= min) return 0
    if (depth >= max) return 1
    for (let i = 1; i < anchors.length; i++) {
      if (depth <= anchors[i][0]) {
        return lerp(
          depth,
          [anchors[i - 1][0], anchors[i][0]],
          [anchors[i - 1][1], anchors[i][1]]
        )
      }
    }
    return 1
  }

  // 0..1 along the rail → metres.
  function toValue (pos) {
    if (pos <= 0) return min
    if (pos >= 1) return max
    for (let i = 1; i < anchors.length; i++) {
      if (pos <= anchors[i][1]) {
        return lerp(
          pos,
          [anchors[i - 1][1], anchors[i][1]],
          [anchors[i - 1][0], anchors[i][0]]
        )
      }
    }
    return max
  }

  return {
    min,
    max,
    toPos,
    toValue,
    anchorDepths: anchors.map(([depth]) => depth)
  }
}

// Depth labels under the rail, chosen the same way the year labels are: by how
// much room they actually get, measured in pixels off the same toPos the
// handles use, so what is drawn is what fits.
//
// Two passes. The layer boundaries the warp is built around go first, each kept
// only if it clears the last one kept; the spans between the survivors are then
// filled with whatever round depths still have room on both sides.
export function tickDepthsFor (
  railLength,
  anchorDepths,
  toPos,
  minGapPx = MIN_TICK_GAP_PX
) {
  if (!railLength) return []
  const minGap = minGapPx / railLength

  const kept = []
  anchorDepths.forEach((depth) => {
    if (!kept.length || toPos(depth) - toPos(kept[kept.length - 1]) >= minGap) {
      kept.push(depth)
    }
  })

  const depths = []
  kept.forEach((depth, index) => {
    depths.push(depth)
    const next = kept[index + 1]
    if (next == null) return
    TICK_FILLERS.filter((filler) => filler > depth && filler < next).forEach(
      (filler) => {
        const last = depths[depths.length - 1]
        if (
          toPos(filler) - toPos(last) >= minGap &&
          toPos(next) - toPos(filler) >= minGap
        ) {
          depths.push(filler)
        }
      }
    )
  })
  return depths
}
