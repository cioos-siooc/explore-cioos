const { createClient } = require("redis");

// REDIS_URL / REDIS_HOST / REDIS_PORT / REDIS_PASSWORD / REDIS_TLS are one
// contract, shared with the harvester's invalidator
// (cde_harvester/redisFunctions.py) — both halves of the cache have to land on
// the same instance, so neither side may grow a variable the other ignores.
//
// The fallback host is the compose service name, matching the harvester's. It
// is only reached when REDIS_HOST is unset, which in compose it never is, so
// this is about the case that does come up: running web-api directly. Point it
// at a redis on the host with REDIS_HOST=localhost in web-api/.env.
const port = process.env.REDIS_PORT || "6379";
const url =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || "redis"}:${port}`;

const socket = {};
if (String(process.env.REDIS_TLS).toLowerCase() === "true") socket.tls = true;

const client = createClient({
  url,
  socket,
  password: process.env.REDIS_PASSWORD || undefined, // ok if unset
});

client.on("error", (err) => {
  // don’t crash the app; cache layer will fall back to memory
  console.error("Redis client error:", err.message);
});

/*
 * Every redis call must be bounded. node-redis keeps retrying a refused
 * connection under its default reconnect strategy, so an un-raced
 * `await connect()` never settles when redis is down — which stalls whatever
 * request sits behind it. Redis is an optimisation here; it must fail in
 * milliseconds rather than hold a response hostage.
 */
const CONNECT_TIMEOUT_MS = 2000;
// After a failure, stop trying for a while rather than paying the timeout on
// every request — but do retry eventually, so a redis that comes back is
// picked up without restarting the API.
const RETRY_AFTER_MS = 60000;

let readyPromise = null;
let unavailableUntil = 0;

function withTimeout(promise, ms, label) {
  let timer;
  const bell = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    // Don't let a pending timer keep the process alive.
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

function markDown(reason) {
  console.error("Redis unavailable, degrading without it:", reason);
  unavailableUntil = Date.now() + RETRY_AFTER_MS;
  readyPromise = null;
}

/*
 * Resolves to the connected client, or null if redis is not usable right now.
 *
 * This lifecycle lives here, in the module that owns the client, because there
 * are two consumers (utils/cache and routes/nonna) and a single shared client:
 * two independent single-flight promises would race each other's connect() and
 * redis@5 throws "Socket already opened" on the second call. One owner, one
 * promise, one retry window — hence the `already opened` tolerance below is
 * only a guard against a connect raced from outside this module.
 *
 * Critically, a failure is NOT memoized as a success: `readyPromise` is
 * cleared, so once the retry window passes the next caller tries again. This
 * module previously memoized the failed init, which pinned a process to the
 * in-memory fallback for its entire lifetime after a single redis blip at
 * startup.
 */
function ensureConnected() {
  if (Date.now() < unavailableUntil) return Promise.resolve(null);
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    try {
      if (!client.isOpen) {
        await withTimeout(
          client.connect(),
          CONNECT_TIMEOUT_MS,
          "redis connect",
        );
      }
    } catch (e) {
      if (!/already opened/i.test(e.message) || !client.isOpen) {
        markDown(e.message);
        return null;
      }
    }
    return client;
  })();
  return readyPromise;
}

module.exports = {
  client,
  ensureConnected,
  markDown,
  withTimeout,
  RETRY_AFTER_MS,
};
