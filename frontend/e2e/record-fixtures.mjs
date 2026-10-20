// Record the fixtures the suites replay from a live deployment.
//
//   node e2e/record-fixtures.mjs [--base=https://explore.cioos.ca] [--max-rows=40]
//
// Navigates by deep link only, so it never has to know the UI. Payloads are
// truncated to --max-rows to stay reviewable in a diff.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import {
  EXTERNAL_HOSTS,
  externalKey,
  isProxiedBasemapTile,
  fixtureKey,
} from "./support/fixtureKey.js";
import {
  CHROMIUM_ARGS,
  FROZEN_TIME,
  RECORDED_VIEWS,
} from "./support/constants.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "fixtures");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")),
);
const BASE = args.base || "https://explore.cioos.ca";
const MAX_ROWS = Number(args["max-rows"] || 40);

// Only truncates; nothing is reshaped, so replays keep the real structure.
function truncate(value) {
  if (Array.isArray(value)) return value.slice(0, MAX_ROWS);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        Array.isArray(inner) ? inner.slice(0, MAX_ROWS) : inner,
      ]),
    );
  }
  return value;
}

const written = new Set();

async function write(relativePath, body) {
  if (written.has(relativePath)) return;
  written.add(relativePath);
  const target = join(FIXTURES, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body);
  console.log(
    "  wrote",
    relativePath,
    typeof body === "string" ? "" : `(${body.length}b)`,
  );
}

const browser = await chromium.launch({ args: CHROMIUM_ARGS });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
});
// The specs' clock, so recorded query strings (dated "today") match theirs.
await context.clock.setSystemTime(FROZEN_TIME);
await context.addCookies([
  { name: "introModalOpen", value: "false", url: BASE },
]);

const page = await context.newPage();

const appOrigin = new URL(BASE).origin;

page.on("response", async (response) => {
  const url = new URL(response.url());
  try {
    // Origin too: Sentry and the analytics beacon also post to /api/ paths.
    if (isProxiedBasemapTile(url)) return;
    if (url.origin === appOrigin && url.pathname.startsWith("/api/")) {
      const key = fixtureKey(response.url());
      if (key.isTile) {
        await write(key.path, await response.body());
      } else {
        await write(
          key.path,
          JSON.stringify(truncate(await response.json()), null, 2),
        );
      }
    } else if (EXTERNAL_HOSTS.has(url.host)) {
      const body = await response.body();
      const extension = url.pathname.endsWith(".pbf")
        ? ".pbf"
        : url.pathname.endsWith(".png")
          ? ".png"
          : ".json";
      await write(externalKey(response.url()) + extension, body);
    }
  } catch (error) {
    // Bodies of redirects and aborted requests are already discarded.
    console.warn("  skipped", url.pathname, "-", error.message);
  }
});

for (const [name, search] of Object.entries(RECORDED_VIEWS)) {
  console.log(`\nrecording "${name}" ${search}`);
  await page.goto(`${BASE}/${search}`, { waitUntil: "domcontentloaded" });
  // Fixed wait, not readiness: it wants requests made after first paint too.
  await page.waitForTimeout(12_000);
}

await browser.close();
console.log(`\n${written.size} fixtures written to e2e/fixtures/`);
