const test = require("node:test");
const assert = require("node:assert/strict");
const apicache = require("apicache");

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
