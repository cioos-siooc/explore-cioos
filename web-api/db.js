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

const db = require("knex")({
  client: "pg",
  connection: {
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    database: DB_NAME,
    port: DB_PORT || 5432,
  },
  // /legend and /download each hold several connections. Postgres's default
  // max_connections of 100 is shared with the harvester, db-loader and
  // Prefect; check that ceiling before raising max.
  pool: {
    min: Number(DB_POOL_MIN || 2),
    max: Number(DB_POOL_MAX || 32),
    acquireTimeoutMillis: 30000,
  },
});

module.exports = db;
