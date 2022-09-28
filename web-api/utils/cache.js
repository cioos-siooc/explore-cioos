console.log("Connecting to redis at", process.env.REDIS_HOST);

const cache = require("express-redis-cache")({
  host: process.env.REDIS_HOST,
});

cache.on("connected", (message) => {
  console.log(message);
});

cache.on("message", (message) => {
  console.log(message);
});

cache.on("error", (error) => {
  if (process.env.ENVIRONMENT === "production") {
    console.log(error);
  } else {
    cache.on("error", (error) => {
      console.error("Running without Redis, that's ok");
      cache.removeAllListeners();
      // hide more error messages
      cache.on("error", () => {});
    });
  }
});

module.exports = cache;
