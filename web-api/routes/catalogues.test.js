const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /catalogues returns each portal with its ERDDAP servers and sources", async () => {
  const rows = [
    {
      name: "CIOOS Pacific",
      hasObis: true,
      erddapServers: ["https://hakai"],
      sources: [
        { name: "CIOOS Pacific", hasObis: true, erddapServers: [] },
        {
          name: "Hakai Institute",
          hasObis: true,
          erddapServers: ["https://hakai"],
        },
      ],
    },
    {
      name: "SLGO",
      hasObis: false,
      erddapServers: ["https://e"],
      sources: [{ name: "SLGO", hasObis: false, erddapServers: ["https://e"] }],
    },
  ];
  db.queueRaw(rows);

  const res = await agent.get("/catalogues");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, rows);
  assert.match(db.queries[0], /ckan_owner IS NOT NULL/);
  // A server goes to the owner of most of its datasets.
  assert.match(db.queries[0], /DISTINCT ON \(erddap_url\)/);
  assert.match(db.queries[0], /ORDER BY erddap_url, count\(\*\) DESC/);
  // Rows from before ckan_sources fall back to their owner.
  assert.match(
    db.queries[0],
    /unnest\(coalesce\(ckan_sources, ARRAY\[ckan_owner\]\)\)/,
  );
});
