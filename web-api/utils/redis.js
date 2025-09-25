const { createClient } = require('redis');

const url =
  process.env.REDIS_URL ||
  (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:6379` : 'redis://localhost:6379');

const socket = {};
if (String(process.env.REDIS_TLS).toLowerCase() === 'true') socket.tls = true;

const client = createClient({
  url,
  socket,
  password: process.env.REDIS_PASSWORD || undefined, // ok if unset
});

client.on('error', (err) => {
  // don’t crash the app; cache layer will fall back to memory
  console.error('Redis client error:', err.message);
});

module.exports = client;

