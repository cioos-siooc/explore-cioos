import { describe, it, expect } from "vitest";

import gridTimeTicks from "./gridTimeTicks.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("gridTimeTicks", () => {
  it("returns nothing for a zero rail length or an inverted/empty span", () => {
    expect(gridTimeTicks(0, 0, 1000)).toEqual([]);
    expect(gridTimeTicks(500, 1000, 1000)).toEqual([]);
    expect(gridTimeTicks(500, 1000, 500)).toEqual([]);
  });

  it("labels an hours-long span with HH:MM, and midnight by its date", () => {
    const minMs = Date.UTC(2020, 0, 1, 0, 0);
    const maxMs = Date.UTC(2020, 0, 1, 12, 0);
    const ticks = gridTimeTicks(600, minMs, maxMs);
    expect(ticks.length).toBeGreaterThan(0);
    ticks.forEach((tick) => expect(tick.label).toMatch(/^\d{2}(:\d{2}|-\d{2})$/));
    expect(ticks[0].label).toBe("01-01"); // the first tick lands on midnight
  });

  it("labels a multi-year span with just the year", () => {
    const minMs = Date.UTC(1990, 0, 1);
    const maxMs = Date.UTC(2020, 0, 1);
    const ticks = gridTimeTicks(600, minMs, maxMs);
    expect(ticks.length).toBeGreaterThan(0);
    ticks.forEach((tick) => expect(tick.label).toMatch(/^\d{4}$/));
  });

  it("falls back to endpoint-only ticks for a span too short for two round instants", () => {
    // Starts mid-hour so only a single hour-mark falls inside the 35-minute
    // span — the finest candidate (1-hour multiples) can't land twice, and
    // it's tried before any coarser one, so nothing is left to label a set.
    const minMs = Date.UTC(2020, 0, 1, 0, 40);
    const maxMs = minMs + 35 * 60 * 1000;
    const ticks = gridTimeTicks(2000, minMs, maxMs);
    expect(ticks).toHaveLength(2);
    expect(ticks[0].value).toBe(minMs);
    expect(ticks[1].value).toBe(maxMs);
  });

  it("produces fewer ticks on a narrower rail for the same span", () => {
    const minMs = Date.UTC(2000, 0, 1);
    const maxMs = Date.UTC(2020, 0, 1);
    const wide = gridTimeTicks(2000, minMs, maxMs);
    const narrow = gridTimeTicks(200, minMs, maxMs);
    expect(narrow.length).toBeLessThanOrEqual(wide.length);
  });

  it("keeps every tick within [minMs, maxMs]", () => {
    const minMs = Date.UTC(2018, 3, 5, 6);
    const maxMs = minMs + 10 * DAY;
    const ticks = gridTimeTicks(800, minMs, maxMs);
    ticks.forEach((tick) => {
      expect(tick.value).toBeGreaterThanOrEqual(minMs);
      expect(tick.value).toBeLessThanOrEqual(maxMs);
    });
  });
});
