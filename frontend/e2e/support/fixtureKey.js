import { createHash } from "node:crypto";

// Shared by the recorder, the Playwright router and the jsdom fetch stub.

// These default to "today" or are cache-busters, and would fragment fixtures
// into one file per run.
const VOLATILE_PARAMS = new Set(["scrubTime", "nonce", "_", "timeMax"]);

// `path` is relative to e2e/fixtures/.
export function fixtureKey(rawUrl) {
  const url = new URL(rawUrl);
  const pathname = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");

  // By z/x/y only, or every filter combination would need its own tiles.
  const tile =
    /^(tiles(?:\/cells|\/tracks)?|nonna(?:\/10)?)\/(\d+)\/(\d+)\/(\d+)\.(mvt|png)$/.exec(
      pathname,
    );
  if (tile) {
    const [, kind, z, x, y, ext] = tile;
    return {
      name: kind.replace(/\//g, "-"),
      path: `tiles/${kind.replace(/\//g, "-")}/${z}-${x}-${y}.${ext}`,
      isTile: true,
    };
  }

  const name = (pathname || "root").replace(/\//g, "_");
  const query = [...url.searchParams]
    .filter(([key, value]) => !VOLATILE_PARAMS.has(key) && value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  if (!query) return { name, path: `api/${name}.json`, isTile: false };

  const readable = query.replace(/[^A-Za-z0-9=,.-]/g, "_").slice(0, 48);
  const hash = createHash("sha1").update(query).digest("hex").slice(0, 8);
  return {
    name,
    path: `api/${name}__${readable}__${hash}.json`,
    isTile: false,
    query,
  };
}

// Replayed, not blocked: without a valid TileJSON the basemap never loads and
// the first-paint splash never lifts.
export const EXTERNAL_HOSTS = new Set([
  "tiles.openfreemap.org",
  "server.arcgisonline.com",
]);

// Basemap rasters the API proxies (web-api/routes/emodnet.js): neither recorded
// nor replayed, but blanked like the third-party ones above.
export function isProxiedBasemapTile(url) {
  return /\/emodnet\/\d+\/\d+\/\d+\.webp$/.test(url.pathname);
}

export function externalKey(rawUrl) {
  const url = new URL(rawUrl);
  const slug = `${url.host}${url.pathname}`.replace(/[^A-Za-z0-9.-]/g, "_");
  return `basemap/${slug}`;
}
