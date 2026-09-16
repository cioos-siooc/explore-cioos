const test = require("node:test");
const assert = require("node:assert/strict");
const apicache = require("apicache");
const express = require("express");
const http = require("node:http");

const { createCache, _resetAdapterForTests } = require("./cache");

/*
 * The behaviour under test is the degradation path, which used to be a live
 * bug: a single failed connect was memoized as a decision, so one redis blip
 * at startup pinned the process to apicache's per-process in-memory store
 * until it was restarted — behind one console.warn.
 *
 * A fake redis module stands in for utils/redis so both branches, and the
 * retry between them, run in one process. apicache's adapter is a
 * process-global, hence the reset between tests.
 */

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

  // The retry: this is what the old memoized-failure version could never do.
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

  // apicache is a singleton; re-installing would swap the adapter under
  // in-flight cache reads for no reason.
  assert.equal(
    apicache.options().redisClient,
    first,
    "the adapter object must not be replaced on later requests",
  );
  assert.equal(redis.state.attempts, 4, "each request still asks redis");
});

test("the adapter speaks the node_redis v2 API apicache expects", async () => {
  // apicache 1.6.3 gates every read and write on a plain `.connected` boolean
  // and calls callback-style hset/hgetall/expire/del. Passed a raw redis@5
  // client, `redis.connected` is undefined, so NOTHING is ever cached and
  // every request recomputes against Postgres.
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

  // EXPIRE needs a positive integer; apicache passes duration(ms)/1000, which
  // is fractional for anything under a second.
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

/*
 * The store path, end to end through real apicache.
 *
 * apicache writes an entry only when the response it sees has a body
 * (`res._apicache.content` in its res.end patch). Express answers a
 * conditional request by stripping the body and sending 304, so a browser
 * holding an ETag could revalidate forever against an empty cache: each
 * request ran the full query, returned 304, and stored nothing, so the entry
 * was never written and the next request missed too. On prod that was ~3 s of
 * Postgres per map tile per revalidation, permanently — the cache could not
 * warm up for anyone who had visited before.
 *
 * routePipeline's fullResponseForCacheMiss closes it; this pins the
 * consequence that matters, which the pipeline's own unit test cannot see:
 * whether an entry actually lands.
 */
/*
 * apicache.clear() with no target only empties its memory store — the
 * clear-by-key branch is the one that calls clearTimeout, so a bare clear()
 * leaves the entry's expiry timer (here 24 h) armed and the test runner hangs
 * on an open handle. The unit-test script runs without --test-force-exit, so
 * clearing has to go key by key.
 */
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

// A browser that already holds an ETag, revalidating against a cold cache —
// the state every returning visitor is in after a deploy or a harvest flush.
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
  // The regression itself. Kept executable so the fix above cannot be dropped
  // silently: every repeat re-runs the query and nothing is ever stored.
  const { runs, statuses, entries } = await revalidateTwiceAgainstColdCache([
    apicache.middleware("24 hours"),
  ]);

  assert.equal(entries, 0);
  assert.deepEqual(statuses, [304, 304]);
  assert.equal(runs, 3, "every revalidation pays the query again");
});

/*
 * Compression of the stored body (see the header comment in cache.js). The
 * adapter is the only thing that touches the bytes, so these drive it directly
 * rather than through a route.
 */
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

  // What apicache actually writes: the whole cache object as one JSON string.
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
  // Every .mvt tile is a Buffer, and it is Buffer-ness that makes the stored
  // JSON balloon (one byte becomes 3-4 ASCII chars), so it is the case that
  // matters most. apicache JSON-serializes it and rebuilds it on the way out.
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
  // A rolling deploy, or a rollback, leaves unmarked values in redis. They
  // must not read as garbage.
  const client = storingClient();
  const adapter = await adapterOver(client);
  client.hashes.set("legacy", { response: '{"status":200}', duration: "1000" });

  const { response } = await roundTrip(adapter, "legacy");
  assert.equal(response, '{"status":200}');
});

test("an unreadable body reads as a miss instead of throwing", async () => {
  // apicache parses this inside its own callback, where a throw would escape
  // as an unhandled exception and take the process down. A miss regenerates.
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
  /*
   * apicache issues hset(response) -> hset(duration) -> expire(key) back to
   * back without awaiting. If compression deferred the hSet to a later tick,
   * EXPIRE would reach redis before the key existed, return 0, and the entry
   * would sit there with no TTL until eviction. Pins the ordering, which is
   * why packResponse is the sync zlib call.
   */
  const client = storingClient();
  const adapter = await adapterOver(client);

  adapter.hset("k", "response", JSON.stringify({ data: "y".repeat(3000) }));
  assert.ok(
    client.hashes.has("k"),
    "hSet must be issued before hset() returns, not on a later tick",
  );
});
