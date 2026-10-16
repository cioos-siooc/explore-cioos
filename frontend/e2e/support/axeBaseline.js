import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect } from "@playwright/test";

import { FIXTURES_DIR } from "./fixturesDir.js";

const BASELINE = join(FIXTURES_DIR, "..", "a11y-baseline.json");

// The Canadian federal bar. Not 'best-practice': its landmark/region rules
// flood a map-first app whose chrome legitimately floats.
export const A11Y_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

export function readBaseline() {
  return existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
}

export async function scan(page) {
  // Mid-transition colours change contrast counts between runners.
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important}",
  });
  return (
    new AxeBuilder({ page })
      .withTags(A11Y_TAGS)
      // Exclude upstream's subtree rather than disable rules it trips, which
      // would hide the same problems in our own markup.
      .exclude(".maplibregl-canvas-container")
      .exclude(".maplibregl-ctrl")
      .analyze()
  );
}

// A ratchet: any unbaselined rule fails, and a baselined one may only shrink
// (and says so, so the baseline gets lowered by hand).
export function expectNoNewViolations(state, results) {
  const baseline = readBaseline()[state] ?? {};
  const counted = Object.fromEntries(
    results.violations.map((violation) => [
      violation.id,
      violation.nodes.length,
    ]),
  );

  const introduced = results.violations.filter(
    (violation) => !(violation.id in baseline),
  );
  expect(
    introduced.map((violation) => `${violation.id}: ${violation.help}`),
    `new accessibility violations on "${state}"`,
  ).toEqual([]);

  for (const [rule, allowed] of Object.entries(baseline)) {
    const actual = counted[rule] ?? 0;
    expect(
      actual,
      `"${rule}" on "${state}" grew past its baseline`,
    ).toBeLessThanOrEqual(allowed);
    if (actual < allowed) {
      console.log(
        `a11y baseline for "${rule}" on "${state}" is ${allowed} but only ${actual} remain — lower it`,
      );
    }
  }
}

// `npm run test:a11y:baseline`.
export function recordBaseline(state, results) {
  const baseline = readBaseline();
  baseline[state] = Object.fromEntries(
    results.violations.map((violation) => [
      violation.id,
      violation.nodes.length,
    ]),
  );
  writeFileSync(BASELINE, JSON.stringify(baseline, null, 2) + "\n");
}

export const RECORDING = process.env.A11Y_BASELINE === "record";
