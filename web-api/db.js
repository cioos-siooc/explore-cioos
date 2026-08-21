const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config();

const {
  DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT,
  DB_POOL_MIN, DB_POOL_MAX,
} = process.env;

console.log("Connected to DB:", DB_HOST, DB_NAME, DB_PORT);

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
  pool: {
    min: Number(DB_POOL_MIN || 2),
    max: Number(DB_POOL_MAX || 16),
    acquireTimeoutMillis: 30000,
  },
});

module.exports = db;
