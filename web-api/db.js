const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config({ quiet: true });

const {
  DB_USER,
  DB_PASSWORD,
  DB_HOST,
  DB_NAME,
  DB_PORT,
  DB_POOL_MIN,
  DB_POOL_MAX,
} = process.env;

// Deliberately silent at import. knex is lazy — it connects on the first query,
// not here — so the "Connected to DB" banner this module used to print was both
// untrue and emitted by merely requiring any util that touches the database.
// bin/www logs the *target* at startup instead.
const db = require("knex")({
  client: "pg",
  connection: {
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    database: DB_NAME,
    port: DB_PORT || 5432,
  },
  // Explicit pool so a slow DB (e.g. during a harvest load) degrades into
  // clear acquire-timeout errors instead of every request queueing until
  // nginx 504s and the API stops responding entirely.
  //
  // A request is not one connection: /legend runs its two aggregations
  // concurrently (routes/legend.js) and /download holds three or more. At the
  // old max of 16 that is ~8 concurrent legend requests, or five alongside a
  // download, before callers start waiting out the 30 s acquire timeout — and
  // /legend gates first map paint, so the saturation point is "eight people
  // opened the map at once". 32 leaves headroom against Postgres's default
  // max_connections of 100, which this API shares with the harvester, the
  // db-loader and Prefect; check that ceiling before raising this again.
  pool: {
    min: Number(DB_POOL_MIN || 2),
    max: Number(DB_POOL_MAX || 32),
    acquireTimeoutMillis: 30000,
  },
});

module.exports = db;
