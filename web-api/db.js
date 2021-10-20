const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config();
const { DB_USER, DB_PASSWORD, DB_HOST, DB_NAME } = process.env;

console.log(DB_USER, DB_PASSWORD, DB_HOST, DB_NAME);

const db = require("knex")({
  client: "pg",
  connection: {
    user: DB_USER,
    password: DB_PASSWORD,
    host: DB_HOST,
    database: DB_NAME,
  },
});

module.exports = db;
