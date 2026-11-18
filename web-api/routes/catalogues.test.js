const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /catalogues returns each portal with its ERDDAP servers", async () => {
  const rows = [
    { name: "CIOOS Pacific", hasObis: true, erddapServers: [] },
    { name: "SLGO", hasObis: false, erddapServers: ["https://e"] },
  ];
  db.queueRaw(rows);

  const res = await agent.get("/catalogues");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, rows);
  assert.match(db.queries[0], /ckan_owner IS NOT NULL/);
  // A server goes to the owner of most of its datasets.
  assert.match(db.queries[0], /DISTINCT ON \(erddap_url\)/);
  assert.match(db.queries[0], /ORDER BY erddap_url, count\(\*\) DESC/);
});
