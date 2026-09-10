const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

test("GET /datasets returns the dataset rows as-is", async () => {
  const rows = [
    {
      title: "A dataset",
      pk: 1,
      organization_pks: [1],
      platform: "mooring",
      erddap_url: "https://erddap.example.com/erddap",
      title_translated: { en: "A dataset", fr: null },
    },
  ];
  db.queueRaw(rows);

  const res = await agent.get("/datasets");

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, rows);
  assert.match(db.queries[0], /FROM cde\.datasets/);
});
