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

test("GET /datasets counts only datasets /pointQuery can return", async () => {
  db.queueRaw([]);

  await agent.get("/datasets");

  const sql = db.queries[0];
  assert.match(sql, /FROM cde\.profiles p WHERE p\.dataset_pk = d\.pk/);
  assert.match(sql, /FROM cde\.trajectory_hexes t/);
  assert.match(sql, /FROM cde\.obis_cells o WHERE o\.dataset_pk = d\.pk/);
  assert.match(
    sql,
    /d\.cdm_data_type = 'Grid' AND d\.coverage_bbox IS NOT NULL/,
  );
});
