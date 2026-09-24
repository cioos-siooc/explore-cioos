const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("node:http");

require("express-async-errors");
const {
  pipeline,
  errorHandler,
  fullResponseForCacheMiss,
} = require("./routePipeline");

/*
 * The pipeline is exercised through a real express app rather than by calling
 * the middlewares directly: the thing under test IS the assembled chain, and
 * express-validator only populates its result from a request that actually
 * went through the router. `cacheFor: null` keeps apicache — and therefore
 * redis — out of it; the cache stage's POSITION is asserted structurally
 * instead, at the bottom of this file.
 */
function serve(stages, handler = (req, res) => res.json({ ok: true })) {
  const app = express();
  app.get("/probe/:z?/:x?/:y?", ...stages, handler);
  app.use((err, req, res, _next) => {
    res
      .status(err.statusCode || err.status || 500)
      .json({ error: err.message });
  });
  const server = app.listen(0);
  const base = () => `http://127.0.0.1:${server.address().port}`;
  return {
    get: (path) => fetch(base() + path),
    close: () => server.close(),
  };
}

async function statusOf(stages, path, handler) {
  const app = serve(stages, handler);
  try {
    return (await app.get(path)).status;
  } finally {
    app.close();
  }
}

test("pipeline returns a fresh chain per call", () => {
  const a = pipeline({ cacheFor: null });
  const b = pipeline({ cacheFor: null });
  assert.notStrictEqual(a, b);
  // The bug this replaces: requiredShapeMiddleware `use`d its stack onto a
  // module-level router, so the second route to mount it got two copies of
  // every validator and the length grew with each call.
  assert.strictEqual(a.length, b.length);
});

test("the shared filter params are accepted when valid", async () => {
  const query = [
    "timeMin=2020-01-01T00:00:00Z",
    "depthMax=100",
    "organizations=1,2",
    "eovs=oxygen,seaSurfaceTemperature",
    "platforms=research vessel,profiling float",
    "obisNodes=Ocean Biodiversity Information System (OBIS) Canada",
    "erddapServers=https://data.cioospacific.ca/erddap",
    "includeObis=false",
    "includeTrajectory=false",
    "metric=days",
    "profileTypes=Profile,TimeSeries",
    "trajectoryTypes=Trajectory",
    "eovsMatch=all",
    "excludeOrganizations=3",
    "excludePlatforms=mooring",
    "excludeObisNodes=OBIS USA",
    "excludeErddapServers=https://erddap.example",
    "excludeEovs=salinity",
    "organizationsMatch=all",
    "scientificNamesMatch=any",
    "excludeScientificNames=Gadus morhua",
  ].join("&");
  assert.strictEqual(
    await statusOf(pipeline({ cacheFor: null }), `/probe?${query}`),
    200,
  );
});

test("params that used to reach the query unvalidated are now rejected", async () => {
  const stages = pipeline({ cacheFor: null });
  for (const query of [
    "includeObis=yes",
    "includeTrajectory=0",
    "metric=count",
    "profileTypes=Profile,DROP",
    "trajectoryTypes=Glider",
    `platforms=${"x".repeat(4001)}`,
    `obisNodes=${"x".repeat(4001)}`,
    `erddapServers=${"x".repeat(4001)}`,
    "eovsMatch=every",
    "excludeOrganizations=1;DROP",
    `excludePlatforms=${"x".repeat(4001)}`,
    `excludeObisNodes=${"x".repeat(4001)}`,
    `excludeErddapServers=${"x".repeat(4001)}`,
    "excludeEovs=salinity;DROP",
    "organizationsMatch=most",
    "scientificNamesMatch=1",
    "excludeScientificNames=Gadus;morhua",
  ]) {
    assert.strictEqual(
      await statusOf(stages, `/probe?${query}`),
      400,
      `expected 400 for ?${query.slice(0, 40)}`,
    );
  }
});

test("an empty type list is a selection, not a malformed one", async () => {
  // profileTypes= / trajectoryTypes= is how the map says "none of that
  // geometry" — distinct from the param being absent, which means "all".
  const stages = pipeline({ cacheFor: null });
  assert.strictEqual(await statusOf(stages, "/probe?profileTypes="), 200);
  assert.strictEqual(await statusOf(stages, "/probe?trajectoryTypes="), 200);
});

test("tile coordinates are validated instead of reaching PostGIS as NaN", async () => {
  const stages = pipeline({ filters: false, cacheFor: null, tileParams: {} });
  assert.strictEqual(await statusOf(stages, "/probe/abc/1/1"), 400);
  assert.strictEqual(await statusOf(stages, "/probe/-1/0/0"), 400);
  assert.strictEqual(await statusOf(stages, "/probe/99/0/0"), 400);
  // 2 tiles per axis at z1, so index 2 is off the grid.
  assert.strictEqual(await statusOf(stages, "/probe/1/2/0"), 400);
  assert.strictEqual(await statusOf(stages, "/probe/1/0/2"), 400);
  assert.strictEqual(await statusOf(stages, "/probe/1/1/1"), 200);
  assert.strictEqual(
    await statusOf(
      pipeline({ filters: false, cacheFor: null, tileParams: { maxZoom: 5 } }),
      "/probe/6/0/0",
    ),
    400,
  );
});

test("a half-specified rectangle is rejected under shape", async () => {
  const stages = pipeline({ shape: true, cacheFor: null });
  assert.strictEqual(await statusOf(stages, "/probe?latMin=40"), 400);
  assert.strictEqual(
    await statusOf(stages, "/probe?latMin=40&latMax=50&lonMin=-70&lonMax=-60"),
    200,
  );
  assert.strictEqual(await statusOf(stages, "/probe"), 200);
});

test("route-specific checks run in the same chain", async () => {
  const { check } = require("express-validator");
  const stages = pipeline({
    cacheFor: null,
    checks: [check("email").isEmail()],
  });
  assert.strictEqual(await statusOf(stages, "/probe?email=nope"), 400);
  assert.strictEqual(await statusOf(stages, "/probe?email=a@b.ca"), 200);
});

test("a handler error carries its own status out", async () => {
  // How every route now reports a client error: throw, and let the app-level
  // handler read statusCode. dbFilter's InvalidPolygonError and
  // ScientificNameSelectionTooBroadError are the two that matter.
  const stages = pipeline({ cacheFor: null });
  const tooBroad = () => {
    const err = new Error("too broad");
    err.statusCode = 400;
    throw err;
  };
  assert.strictEqual(
    await statusOf(stages, "/probe", async () => tooBroad()),
    400,
  );
  assert.strictEqual(
    await statusOf(stages, "/probe", async () => {
      throw new Error("db is down");
    }),
    500,
  );
});

test("the cache is the last stage before the handler", () => {
  // Order is the whole point of this module: /legend and /timeExtent used to
  // register the cache FIRST, which let apicache store a 400 under the
  // request's key. After errorHandler come the cache and its miss companion,
  // and nothing else.
  const stages = pipeline();
  assert.strictEqual(stages.length, pipeline({ cacheFor: null }).length + 2);
  assert.strictEqual(stages[stages.length - 3], errorHandler);
  assert.strictEqual(typeof stages[stages.length - 2], "function");
  assert.strictEqual(stages[stages.length - 1], fullResponseForCacheMiss);
});

test("the cache-miss stage is registered only when caching is on", () => {
  // Without a cache there is nothing to fill, so a 304 is pure win and the
  // conditional headers must survive.
  assert.ok(!pipeline({ cacheFor: null }).includes(fullResponseForCacheMiss));
});

/*
 * A browser revalidating a stale-but-ETagged response, which node:fetch cannot
 * model: undici attaches `cache-control: no-cache` to every request it makes,
 * and express's `req.fresh` returns false the moment it sees that — so a
 * conditional GET over fetch comes back 200 no matter what the server does.
 * The raw client sends exactly the two headers a browser would.
 */
function revalidate(stagesBeforeHandler) {
  const app = express();
  app.get("/probe", ...stagesBeforeHandler, (req, res) =>
    res.json({ ok: true }),
  );
  const server = app.listen(0);
  const request = (headers) =>
    new Promise((resolve, reject) => {
      http
        .get(
          { port: server.address().port, path: "/probe", headers },
          (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
              resolve({ status: res.statusCode, etag: res.headers.etag, body }),
            );
          },
        )
        .on("error", reject);
    });
  return { request, close: () => server.close() };
}

test("a cache miss answers a conditional request with a full body", async () => {
  /*
   * The regression this stage exists to prevent: apicache only stores a
   * response that HAS a body, and Express answers If-None-Match by stripping
   * the body and sending 304. A revalidation that missed the cache therefore
   * ran the whole query and stored nothing, so the entry was never written and
   * the next revalidation missed too — measured at ~3 s per repeat on prod,
   * indefinitely. Past the cache stage a request is a miss by construction, so
   * it has to come back as something the cache can keep.
   */
  const client = revalidate([fullResponseForCacheMiss]);
  try {
    const { etag } = await client.request();
    assert.ok(etag, "express must offer an ETag for this to be a real test");

    const revalidated = await client.request({ "If-None-Match": etag });
    assert.strictEqual(revalidated.status, 200);
    assert.deepStrictEqual(JSON.parse(revalidated.body), { ok: true });
  } finally {
    client.close();
  }
});

test("without the stage express downgrades the same request to 304", async () => {
  // Pins the cause, so the test above cannot quietly stop testing anything if
  // Express's conditional handling changes.
  const client = revalidate([]);
  try {
    const { etag } = await client.request();
    const revalidated = await client.request({ "If-None-Match": etag });
    assert.strictEqual(revalidated.status, 304);
    assert.strictEqual(revalidated.body, "");
  } finally {
    client.close();
  }
});
