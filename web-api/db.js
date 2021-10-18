const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config();

const db = require("knex")({
  client: "pg",
  connection: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
  },
});
console.log(process.env.database);
module.exports = db;
