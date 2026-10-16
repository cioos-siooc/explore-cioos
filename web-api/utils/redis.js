const { createClient } = require("redis");

// The REDIS_* variables are one contract with the harvester's invalidator
// (cde_harvester/redisFunctions.py): both must land on the same instance.
const port = process.env.REDIS_PORT || "6379";
const url =
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || "redis"}:${port}`;

const socket = {};
if (String(process.env.REDIS_TLS).toLowerCase() === "true") socket.tls = true;

const client = createClient({
  url,
  socket,
  password: process.env.REDIS_PASSWORD || undefined,
});

client.on("error", (err) => {
  // don't crash the app; the cache falls back to memory
  console.error("Redis client error:", err.message);
});

// node-redis retries a refused connection forever, so an un-raced connect()
// never settles when redis is down and would stall the request behind it.
const CONNECT_TIMEOUT_MS = 2000;
// Retry eventually so a redis that comes back is picked up without a restart.
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
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
}

function markDown(reason) {
  console.error("Redis unavailable, degrading without it:", reason);
  unavailableUntil = Date.now() + RETRY_AFTER_MS;
  readyPromise = null;
}

// The single owner of connect() for both consumers (utils/cache,
// routes/nonna): redis@5 throws "Socket already opened" on a second
// concurrent connect. A failure clears readyPromise so it is never pinned.
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
