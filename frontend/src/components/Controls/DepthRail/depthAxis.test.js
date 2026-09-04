import { describe, it, expect } from 'vitest'

import {
  MIN_TICK_GAP_PX,
  clampDepth,
  createDepthAxis,
  snapToMetre,
  tickDepthsFor
} from './depthAxis.js'

// The filter's own domain: the deepest trench, even though nearly every record
// sits in the top few hundred metres — which is what the warp is for.
const FULL = [0, 12000]

describe('createDepthAxis', () => {
  const axis = createDepthAxis(...FULL)

  it('pins the domain ends to the ends of the rail', () => {
    expect(axis.toPos(0)).toBe(0)
    expect(axis.toPos(12000)).toBe(1)
    expect(axis.toValue(0)).toBe(0)
    expect(axis.toValue(1)).toBe(12000)
  })

  it('is monotonic, so a handle dragged right never moves shallower', () => {
    const depths = [0, 25, 100, 250, 500, 1000, 2000, 4000, 8000, 12000]
    const positions = depths.map(axis.toPos)
    positions.forEach((pos, i) => {
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1])
    })
  })

  it('round-trips every position through toValue and back', () => {
    for (let pos = 0; pos <= 1.0001; pos += 0.05) {
      expect(axis.toPos(axis.toValue(pos))).toBeCloseTo(Math.min(pos, 1), 6)
    }
  })

  it('gives the sunlit top 100 m a fifth of the rail', () => {
    // A linear axis would put it in the first centimetre; this is the point of
    // the warp, so it is worth pinning.
    expect(axis.toPos(100)).toBeCloseTo(0.22, 6)
    expect(axis.toPos(100)).toBeGreaterThan(100 / 12000)
  })

  it('clamps outside the domain rather than extrapolating', () => {
    expect(axis.toPos(-50)).toBe(0)
    expect(axis.toPos(99999)).toBe(1)
  })

  it('drops the stops a narrowed domain excludes and still spans the rail', () => {
    const shallow = createDepthAxis(0, 300)
    expect(shallow.anchorDepths).toEqual([0, 100, 300])
    expect(shallow.toPos(300)).toBe(1)
    expect(shallow.toValue(1)).toBe(300)
  })
})

describe('clampDepth and snapToMetre', () => {
  it('clamps into the domain', () => {
    expect(clampDepth(-5, 0, 12000)).toBe(0)
    expect(clampDepth(20000, 0, 12000)).toBe(12000)
    expect(clampDepth(250, 0, 12000)).toBe(250)
  })

  it('falls back to the minimum for an unparseable depth', () => {
    expect(clampDepth(NaN, 0, 12000)).toBe(0)
  })

  it('snaps to whole metres', () => {
    // Fractional metres from a drag would key a new API request every frame.
    expect(snapToMetre(250.4)).toBe(250)
    expect(snapToMetre(250.6)).toBe(251)
  })
})

describe('tickDepthsFor', () => {
  const axis = createDepthAxis(...FULL)

  it('draws nothing before the rail has been measured', () => {
    expect(tickDepthsFor(0, axis.anchorDepths, axis.toPos)).toEqual([])
  })

  it('keeps every label at least the minimum gap from the last', () => {
    const railLength = 600
    const ticks = tickDepthsFor(railLength, axis.anchorDepths, axis.toPos)
    expect(ticks.length).toBeGreaterThan(1)
    ticks.forEach((depth, i) => {
      if (i === 0) return
      const gapPx = (axis.toPos(depth) - axis.toPos(ticks[i - 1])) * railLength
      expect(gapPx).toBeGreaterThanOrEqual(MIN_TICK_GAP_PX)
    })
  })

  it('is ascending and starts at the domain minimum', () => {
    const ticks = tickDepthsFor(600, axis.anchorDepths, axis.toPos)
    expect(ticks[0]).toBe(0)
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
  })

  it('shows more labels on a longer rail and fewer on a shorter one', () => {
    const short = tickDepthsFor(200, axis.anchorDepths, axis.toPos)
    const long = tickDepthsFor(1200, axis.anchorDepths, axis.toPos)
    expect(long.length).toBeGreaterThan(short.length)
  })

  it('lets the vertical rail stack many more labels', () => {
    // Down the rail what has to clear is line height, not label width.
    const across = tickDepthsFor(600, axis.anchorDepths, axis.toPos, MIN_TICK_GAP_PX)
    const down = tickDepthsFor(600, axis.anchorDepths, axis.toPos, 16)
    expect(down.length).toBeGreaterThan(across.length)
  })

  it('gives the layer boundaries first refusal over the round fillers', () => {
    // The stops are what explain the warp, so they are kept before 25/50/200/…
    const ticks = tickDepthsFor(1200, axis.anchorDepths, axis.toPos)
    expect(ticks).toEqual(expect.arrayContaining([100, 500, 1000, 4000]))
  })
})
