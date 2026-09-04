import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { FIXTURES_DIR } from './fixturesDir.js'

const BASELINE = join(FIXTURES_DIR, '..', 'a11y-baseline.json')

// WCAG 2.0/2.1 A and AA — the level Canadian federal accessibility policy
// targets, which is the right bar for a national service. Deliberately not
// axe's 'best-practice' tags: they are opinionated (landmark/region rules in
// particular) and would flood a map-first app whose chrome legitimately floats.
export const A11Y_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

export function readBaseline () {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}
}

export async function scan (page) {
  return new AxeBuilder({ page })
    .withTags(A11Y_TAGS)
    // MapLibre injects its own canvas and controls. Their accessibility is
    // upstream's to fix and not something this codebase can change; excluding a
    // third-party subtree is honest, whereas switching off the rules it trips
    // would hide the same problems in our own markup.
    .exclude('.maplibregl-canvas-container')
    .exclude('.maplibregl-ctrl')
    .analyze()
}

/**
 * Assert a scan against the recorded baseline.
 *
 * Two rules, and they are what make this a ratchet rather than a mute:
 *   1. a rule that is not in the baseline at all is always a hard failure, even
 *      while other rules are being tolerated;
 *   2. a baselined rule may match fewer nodes than recorded, never more — and
 *      when it matches fewer, the message says so, so the number comes down by
 *      hand and the file keeps meaning something.
 */
export function expectNoNewViolations (state, results) {
  const baseline = readBaseline()[state] ?? {}
  const counted = Object.fromEntries(
    results.violations.map((violation) => [violation.id, violation.nodes.length])
  )

  const introduced = results.violations.filter((violation) => !(violation.id in baseline))
  expect(
    introduced.map((violation) => `${violation.id}: ${violation.help}`),
    `new accessibility violations on "${state}"`
  ).toEqual([])

  for (const [rule, allowed] of Object.entries(baseline)) {
    const actual = counted[rule] ?? 0
    expect(actual, `"${rule}" on "${state}" grew past its baseline`).toBeLessThanOrEqual(allowed)
    if (actual < allowed) {
      console.log(
        `a11y baseline for "${rule}" on "${state}" is ${allowed} but only ${actual} remain — lower it`
      )
    }
  }
}

// Written by `npm run test:a11y:baseline`. Recording rather than asserting is a
// one-off: the file is a to-do list, and shrinking it is an ordinary PR.
export function recordBaseline (state, results) {
  const baseline = readBaseline()
  baseline[state] = Object.fromEntries(
    results.violations.map((violation) => [violation.id, violation.nodes.length])
  )
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + '\n')
}

export const RECORDING = process.env.A11Y_BASELINE === 'record'
