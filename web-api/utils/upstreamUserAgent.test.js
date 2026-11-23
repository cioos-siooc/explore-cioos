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

test("the agent names the deployment and build compose passes in", (t) => {
  const path = require.resolve("./upstreamUserAgent");
  const saved = { url: process.env.APP_URL, version: process.env.APP_VERSION };
  t.after(() => {
    for (const [key, value] of [
      ["APP_URL", saved.url],
      ["APP_VERSION", saved.version],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete require.cache[path];
    require(path);
  });
  process.env.APP_URL = "https://explore.example.ca";
  process.env.APP_VERSION = "v1.2.3";
  delete require.cache[path];

  assert.strictEqual(
    require(path).USER_AGENT,
    "CIOOS-CDE-WebAPI/v1.2.3 (+https://explore.example.ca)",
  );
});
