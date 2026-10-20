const test = require("node:test");
const assert = require("node:assert/strict");
const apicache = require("apicache");
const express = require("express");
const http = require("node:http");

const { createCache, _resetAdapterForTests } = require("./cache");

// apicache's adapter is process-global, hence the reset between tests.

function fakeClient() {
  const calls = [];
  return {
    calls,
    isReady: true,
    hSet: async (...a) => (calls.push(["hSet", ...a]), 1),
    hGetAll: async (key) => (calls.push(["hGetAll", key]), {}),
    expire: async (...a) => (calls.push(["expire", ...a]), 1),
    del: async (key) => (calls.push(["del", key]), 1),
  };
}

// Answers `attempts` connect calls with null, then hands back the client.
function fakeRedis({ failFirst = 0, client = fakeClient() } = {}) {
  const state = { attempts: 0, client };
  return {
    state,
    ensureConnected: async () => {
      state.attempts += 1;
      return state.attempts <= failFirst ? null : state.client;
    },
  };
}

test.beforeEach(() => _resetAdapterForTests());
test.after(() => _resetAdapterForTests());

test("a successful connect installs the redis backend", async () => {
  const redis = fakeRedis();
  const cache = createCache({ redis });

  const mw = await cache.ensureReady();

  assert.equal(typeof mw, "function", "returns apicache's middleware factory");
  assert.ok(
    apicache.options().redisClient,
    "the adapter must be handed to apicache, or nothing is ever cached",
  );
});

test("a failed connect degrades to in-memory WITHOUT latching", async () => {
  const redis = fakeRedis({ failFirst: 1 });
  const cache = createCache({ redis });

  const mw = await cache.ensureReady();
  assert.equal(typeof mw, "function", "the request still gets a middleware");
  assert.equal(
    Boolean(apicache.options().redisClient),
    false,
    "no adapter installed while redis is down, so apicache uses its own store",
  );

  const mw2 = await cache.ensureReady();
  assert.equal(redis.state.attempts, 2, "the second request must re-ask redis");
  assert.equal(typeof mw2, "function");
  assert.ok(
    apicache.options().redisClient,
    "redis coming back must be picked up without a restart",
  );
});

test("the adapter is installed exactly once, however many requests arrive", async () => {
  const redis = fakeRedis();
  const cache = createCache({ redis });

  await cache.ensureReady();
  const first = apicache.options().redisClient;

  await Promise.all([
    cache.ensureReady(),
    cache.ensureReady(),
    cache.ensureReady(),
  ]);

  assert.equal(
    apicache.options().redisClient,
    first,
    "the adapter object must not be replaced on later requests",
  );
  assert.equal(redis.state.attempts, 4, "each request still asks redis");
});

test("the adapter speaks the node_redis v2 API apicache expects", async () => {
  const client = fakeClient();
  const cache = createCache({ redis: fakeRedis({ client }) });
  await cache.ensureReady();

  const adapter = apicache.options().redisClient;
  assert.equal(adapter.connected, true);

  client.isReady = false;
  assert.equal(
    adapter.connected,
    false,
    "`connected` must track the live client, not a snapshot",
  );

  // Values must reach redis@5's hSet as strings.
  await new Promise((resolve) => adapter.hset("k", "f", { a: 1 }, resolve));
  assert.deepEqual(client.calls.at(-1), ["hSet", "k", "f", "[object Object]"]);

  // apicache passes duration(ms)/1000, fractional under a second.
  await new Promise((resolve) => adapter.expire("k", 0.4, resolve));
  assert.deepEqual(client.calls.at(-1), ["expire", "k", 1]);

  await new Promise((resolve) => adapter.expire("k", 61.6, resolve));
  assert.deepEqual(client.calls.at(-1), ["expire", "k", 62]);

  // redis@5 returns {} for a missing key, which apicache reads as a miss.
  const got = await new Promise((resolve) =>
    adapter.hgetall("k", (_e, v) => resolve(v)),
  );
  assert.deepEqual(got, {});
});

test("route() is a middleware factory that resolves the backend per request", async () => {
  const redis = fakeRedis();
  const cache = createCache({ redis });

  const mw = cache.route("10 minutes");
  assert.equal(typeof mw, "function");
  assert.equal(mw.length, 3, "an (req, res, next) express middleware");
  assert.equal(
    redis.state.attempts,
    0,
    "building the middleware must not touch redis — routes call this at import",
  );
});

// End to end through real apicache: whether an entry actually lands, which
// routePipeline's own unit test cannot see.
// A bare apicache.clear() leaves each entry's expiry timer armed and the
// runner (no --test-force-exit) hangs on the open handle; clear by key.
function clearAll() {
  apicache.getIndex().all.forEach((key) => apicache.clear(key));
}

function countingApp(stages) {
  let handlerRuns = 0;
  const app = express();
  app.get("/t", ...stages, (req, res) => {
    handlerRuns += 1; // stands in for the tile query
    res.json({ tile: "payload" });
  });
  const server = app.listen(0);
  const get = (headers) =>
    new Promise((resolve, reject) => {
      http
        .get({ port: server.address().port, path: "/t", headers }, (r) => {
          r.resume();
          r.on("end", () =>
            resolve({ status: r.statusCode, etag: r.headers.etag }),
          );
        })
        .on("error", reject);
    });
  return { get, runs: () => handlerRuns, close: () => server.close() };
}

async function revalidateTwiceAgainstColdCache(stages) {
  clearAll();
  const app = countingApp(stages);
  try {
    const { etag } = await app.get();
    clearAll(); // redis wiped: a deploy, or the 24h TTL lapsing
    const first = await app.get({ "If-None-Match": etag });
    const second = await app.get({ "If-None-Match": etag });
    return {
      runs: app.runs(),
      statuses: [first.status, second.status],
      entries: apicache.getIndex().all.length,
    };
  } finally {
    app.close();
    clearAll();
  }
}

test("a conditional request that misses the cache still fills it", async () => {
  const { runs, statuses, entries } = await revalidateTwiceAgainstColdCache([
    apicache.middleware("24 hours"),
    require("./routePipeline").fullResponseForCacheMiss,
  ]);

  assert.equal(entries, 1, "the miss must leave an entry behind");
  assert.deepEqual(
    statuses,
    [200, 304],
    "the miss returns a storable body; the next revalidation is a cheap 304 off that entry",
  );
  assert.equal(
    runs,
    2,
    "one run to mint the ETag, one to refill the cache — the second revalidation is served by apicache",
  );
});

test("without the stage the cache can never fill from a revalidation", async () => {
  // Kept executable so the fix cannot be dropped silently.
  const { runs, statuses, entries } = await revalidateTwiceAgainstColdCache([
    apicache.middleware("24 hours"),
  ]);

  assert.equal(entries, 0);
  assert.deepEqual(statuses, [304, 304]);
  assert.equal(runs, 3, "every revalidation pays the query again");
});

function storingClient() {
  const hashes = new Map();
  return {
    hashes,
    isReady: true,
    hSet: async (key, field, value) => {
      if (!hashes.has(key)) hashes.set(key, {});
      hashes.get(key)[field] = value;
      return 1;
    },
    hGetAll: async (key) => hashes.get(key) || {},
    expire: async () => 1,
    del: async (key) => (hashes.delete(key), 1),
  };
}

async function adapterOver(client) {
  _resetAdapterForTests();
  const cache = createCache({ redis: fakeRedis({ client }) });
  await cache.ensureReady();
  return apicache.options().redisClient;
}

const roundTrip = (adapter, key) =>
  new Promise((resolve) => adapter.hgetall(key, (_e, obj) => resolve(obj)));

test("the response body is stored compressed, and only the body", async () => {
  const client = storingClient();
  const adapter = await adapterOver(client);

  const body = JSON.stringify({ status: 200, data: "x".repeat(5000) });
  await new Promise((r) => adapter.hset("k", "response", body, r));
  await new Promise((r) => adapter.hset("k", "duration", 86400000, r));

  const stored = client.hashes.get("k");
  assert.ok(
    stored.response.startsWith("gz:"),
    "the body must be marked and compressed",
  );
  assert.ok(
    stored.response.length < body.length / 4,
    `expected a real saving, got ${stored.response.length} from ${body.length}`,
  );
  assert.equal(
    stored.duration,
    "86400000",
    "only `response` is compressed — duration stays a plain string",
  );
});

test("a Buffer body survives the round trip byte for byte", async () => {
  // .mvt tiles are Buffers, the case where stored JSON balloons most.
  const client = storingClient();
  const adapter = await adapterOver(client);

  const tile = Buffer.from(
    Array.from({ length: 2048 }, (_, i) => (i * 7 + 13) % 256),
  );
  const cacheObject = { status: 200, headers: {}, data: tile, timestamp: 1 };
  await new Promise((r) =>
    adapter.hset("t", "response", JSON.stringify(cacheObject), r),
  );

  const { response } = await roundTrip(adapter, "t");
  const parsed = JSON.parse(response);
  assert.deepEqual(
    Buffer.from(parsed.data.data),
    tile,
    "the tile bytes must come back unchanged",
  );
  assert.equal(parsed.status, 200);
});

test("an entry written before compression still reads", async () => {
  // A rolling deploy or rollback leaves unmarked values in redis.
  const client = storingClient();
  const adapter = await adapterOver(client);
  client.hashes.set("legacy", { response: '{"status":200}', duration: "1000" });

  const { response } = await roundTrip(adapter, "legacy");
  assert.equal(response, '{"status":200}');
});

test("an unreadable body reads as a miss instead of throwing", async () => {
  const client = storingClient();
  const adapter = await adapterOver(client);
  client.hashes.set("bad", {
    response: "gz:not-base64-gzip",
    duration: "1000",
  });

  const obj = await roundTrip(adapter, "bad");
  assert.deepEqual(obj, {}, "apicache reads a bodiless object as a miss");
});

test("the store is queued synchronously, so EXPIRE cannot beat the key", async () => {
  const client = storingClient();
  const adapter = await adapterOver(client);

  adapter.hset("k", "response", JSON.stringify({ data: "y".repeat(3000) }));
  assert.ok(
    client.hashes.has("k"),
    "hSet must be issued before hset() returns, not on a later tick",
  );
});

test("a cache hit answers the requesting origin, not the one that filled it", async () => {
  clearAll();
  const cors = require("cors");
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.get("/t", apicache.middleware("24 hours"), (req, res) =>
    res.json({ tile: "payload" }),
  );
  const server = app.listen(0);
  const allowedOriginFor = (origin) =>
    new Promise((resolve, reject) => {
      http
        .get(
          { port: server.address().port, path: "/t", headers: { origin } },
          (r) => {
            r.resume();
            r.on("end", () =>
              resolve(r.headers["access-control-allow-origin"]),
            );
          },
        )
        .on("error", reject);
    });
  try {
    assert.equal(await allowedOriginFor("http://a.test"), "http://a.test");
    assert.equal(apicache.getIndex().all.length, 1, "the hit below is real");
    assert.equal(
      await allowedOriginFor("http://b.test"),
      "http://b.test",
      "a replayed origin makes the browser block the response",
    );
  } finally {
    server.close();
    clearAll();
  }
});
