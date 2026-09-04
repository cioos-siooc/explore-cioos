import { describe, it, expect } from 'vitest'

import {
  MS_PER_DAY,
  clampIso,
  createTimeAxis,
  isoToMs,
  msToIso,
  snapToDay,
  tickYearsFor
} from './timeAxis.js'

// The filter's own domain — defaultStartDate to today. Pinned rather than
// computed so the assertions below don't drift with the clock.
const MIN_ISO = '1900-01-01'
const MAX_ISO = '2026-01-01'

describe('iso <-> ms', () => {
  it('reads dates as UTC midnight, not local', () => {
    // Local-midnight parsing would shift the whole axis by a timezone offset and
    // put a scrubbed day on the wrong tile.
    expect(isoToMs('2020-06-01')).toBe(Date.UTC(2020, 5, 1))
    expect(msToIso(Date.UTC(2020, 5, 1))).toBe('2020-06-01')
  })

  it('round-trips', () => {
    expect(msToIso(isoToMs('1999-12-31'))).toBe('1999-12-31')
  })

  it('snaps to whole UTC days', () => {
    // Tile requests key off the date string; without this a drag would key a
    // new cache entry every animation frame.
    const noon = isoToMs('2020-06-01') + MS_PER_DAY / 2 + 1
    expect(msToIso(snapToDay(noon))).toBe('2020-06-02')
    expect(snapToDay(isoToMs('2020-06-01'))).toBe(isoToMs('2020-06-01'))
  })
})

describe('clampIso', () => {
  it('clamps to either bound', () => {
    expect(clampIso('1850-01-01', MIN_ISO, MAX_ISO)).toBe(MIN_ISO)
    expect(clampIso('2099-01-01', MIN_ISO, MAX_ISO)).toBe(MAX_ISO)
    expect(clampIso('2020-06-01', MIN_ISO, MAX_ISO)).toBe('2020-06-01')
  })

  it('leaves the value alone when a bound is absent', () => {
    expect(clampIso('1850-01-01', undefined, MAX_ISO)).toBe('1850-01-01')
  })
})

describe('createTimeAxis', () => {
  const axis = createTimeAxis(MIN_ISO, MAX_ISO)

  it('pins the domain ends to the ends of the bar', () => {
    expect(axis.toPos(axis.minMs)).toBe(0)
    expect(axis.toPos(axis.maxMs)).toBe(1)
    expect(axis.toMs(0)).toBe(axis.minMs)
    expect(axis.toMs(1)).toBe(axis.maxMs)
  })

  it('is monotonic, so a handle dragged right never moves back in time', () => {
    const years = [1900, 1925, 1950, 1970, 1980, 1995, 2000, 2010, 2020, 2026]
    const positions = years.map((year) => axis.toPos(isoToMs(`${year}-01-01`)))
    positions.forEach((pos, i) => {
      if (i > 0) expect(pos).toBeGreaterThan(positions[i - 1])
    })
  })

  it('round-trips every position through toMs and back', () => {
    for (let pos = 0; pos <= 1.0001; pos += 0.05) {
      expect(axis.toPos(axis.toMs(pos))).toBeCloseTo(Math.min(pos, 1), 6)
    }
  })

  it('compresses the 20th century into the first quarter of the bar', () => {
    // The whole reason for the warp: on a linear axis 1900-2000 would take ~80%
    // of the width for a handful of historical series.
    expect(axis.toPos(isoToMs('2000-01-01'))).toBeCloseTo(0.27, 6)
    expect(axis.toPos(isoToMs('2000-01-01'))).toBeLessThan(0.8)
  })

  it('clamps outside the domain rather than extrapolating', () => {
    expect(axis.toPos(isoToMs('1800-01-01'))).toBe(0)
    expect(axis.toPos(isoToMs('2100-01-01'))).toBe(1)
  })

  it('drops the stops a narrowed domain excludes and still spans the bar', () => {
    const recent = createTimeAxis('2010-01-01', '2020-01-01')
    expect(recent.anchorYears).toEqual([2010, 2020])
    expect(recent.toPos(isoToMs('2015-01-01'))).toBeCloseTo(0.5, 2)
  })

  it('reports the era boundaries as the years that explain the warp', () => {
    expect(axis.anchorYears).toEqual([1900, 1950, 1980, 2000, 2026])
  })
})

describe('tickYearsFor', () => {
  const axis = createTimeAxis(MIN_ISO, MAX_ISO)
  const posOf = (year) => axis.toPos(isoToMs(`${year}-01-01`))

  it('draws nothing before the bar has been measured', () => {
    expect(tickYearsFor(0, axis.anchorYears, axis.toPos)).toEqual([])
  })

  it('keeps every label clear of the last by the minimum gap', () => {
    const railWidth = 800
    const years = tickYearsFor(railWidth, axis.anchorYears, axis.toPos)
    expect(years.length).toBeGreaterThan(2)
    years.forEach((year, i) => {
      if (i === 0) return
      expect((posOf(year) - posOf(years[i - 1])) * railWidth).toBeGreaterThanOrEqual(42)
    })
  })

  it('is ascending and opens at the domain start', () => {
    const years = tickYearsFor(800, axis.anchorYears, axis.toPos)
    expect(years[0]).toBe(1900)
    expect([...years].sort((a, b) => a - b)).toEqual(years)
  })

  it('shows fewer labels on a phone-width bar than a desktop one', () => {
    const phone = tickYearsFor(320, axis.anchorYears, axis.toPos)
    const desktop = tickYearsFor(1200, axis.anchorYears, axis.toPos)
    expect(desktop.length).toBeGreaterThan(phone.length)
    expect(phone.length).toBeGreaterThan(0)
  })

  it('fills spans with round years rather than arbitrary ones', () => {
    // Round decades read as time; 1983 reads as arithmetic.
    const years = tickYearsFor(1200, axis.anchorYears, axis.toPos)
    years
      .filter((year) => !axis.anchorYears.includes(year))
      .forEach((year) => expect(year % 5).toBe(0))
  })
})
