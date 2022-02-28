console.log("Connecting to redis at", process.env.REDIS_HOST);

const cache = require("express-redis-cache")({
  host: process.env.REDIS_HOST,
});

cache.on("connected", function (message) {
  console.log(message);
});

cache.on("message", function (message) {
  console.log(message);
});

cache.on("error", function (error) {
  if (process.env.ENVIRONMENT === "production") {
    console.log(error);
  } else {
    cache.on("error", function (error) {
      console.error("Running without Redis, that's ok");
      cache.removeAllListeners();
      // hide more error messages
      cache.on("error", () => {});
    });
  }
});

module.exports = cache