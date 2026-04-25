const { createClient } = require('redis');

const url =
  process.env.REDIS_URL ||
  (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:6379` : 'redis://localhost:6379');

const socket = {
  // Stop reconnecting after a few failures so a misconfigured Redis
  // (wrong host, bad auth, etc.) doesn't keep the process busy forever.
  reconnectStrategy: (retries) => (retries > 3 ? false : Math.min(retries * 200, 1000)),
};
if (String(process.env.REDIS_TLS).toLowerCase() === 'true') socket.tls = true;

const client = createClient({
  url,
  socket,
  password: process.env.REDIS_PASSWORD || undefined,
  disableOfflineQueue: true,
});

client.on('error', (err) => {
  console.error('Redis client error:', err.message);
});

module.exports = client;
