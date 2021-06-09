const pg = require("pg");

require("pg-parse-float")(pg);
require("dotenv").config();

const db = require("knex")({
  client: "pg",
  connection: {
    user: process.env.user,
    password: process.env.password,
    host: process.env.host,
    database: process.env.database,
  },
});
console.log(process.env.database);
module.exports = db;
