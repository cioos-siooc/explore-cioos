const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const axios = require("axios");
const { USER_AGENT } = require("./upstreamUserAgent");

test("upstream requests identify as the CDE, not as axios", async (t) => {
  const server = http.createServer((req, res) => {
    res.end(JSON.stringify({ userAgent: req.headers["user-agent"] }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const { data } = await axios.get(
    `http://127.0.0.1:${server.address().port}/`,
  );

  assert.strictEqual(data.userAgent, USER_AGENT);
  assert.doesNotMatch(data.userAgent, /axios/i);
});
