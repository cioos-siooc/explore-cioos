const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config();
const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME, DB_PORT } = process.env;

console.log('Connected to DB:', DB_HOST, DB_NAME, DB_PORT);

const db = require("knex")({
  client: "pg",
  connection: {
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    database: DB_NAME,
    port: DB_PORT || 5432,
  },
});

module.exports = db;
