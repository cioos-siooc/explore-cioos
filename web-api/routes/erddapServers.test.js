const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /erddapServers returns the distinct ERDDAP server URLs, excluding the OBIS and CKAN sentinels", async () => {
  db.queueRaw([
    { erddap_url: "https://erddap.example.com/erddap" },
    { erddap_url: "https://erddap2.example.com/erddap" },
  ]);

  const res = await agent.get("/erddapServers");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    "https://erddap.example.com/erddap",
    "https://erddap2.example.com/erddap",
  ]);
  assert.match(db.queries[0], /source_type IS DISTINCT FROM 'obis'/);
  assert.match(db.queries[0], /source_type IS DISTINCT FROM 'ckan'/);
});
