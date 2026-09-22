const test = require("node:test");
const assert = require("node:assert/strict");

const { createTestApp } = require("../test/testApp");

const { agent, db, resetCache } = createTestApp();

test.beforeEach(() => {
  db.reset();
  resetCache();
});

/*
 * The days count is the one that used to dominate this route's latency: it
 * called day_range_overlap_days() once per (feature, bin) pair — re-unnesting
 * and re-sorting the feature's whole daterange[] on every call — and ran a
 * second full scan to total the series. Both are pinned here, because both are
 * invisible from the response: the numbers were correct throughout, only the
 * cost was not.
 */

test("the days count unions each feature's day set once, not once per bin", async () => {
  db.queueRaw([]);

  await agent.get("/coverageHistogram").query({ count: "days" });

  assert.equal(db.queries.length, 1);
  assert.doesNotMatch(db.queries[0], /day_range_overlap_days/);
  // The merge that replaced it, and the binary search over the bin edges that
  // replaced comparing every feature against every bin.
  assert.match(db.queries[0], /starts_island/);
  assert.match(db.queries[0], /width_bucket/);
});

test("the days count answers the series totals from the bars, in one query", async () => {
  db.queueRaw([
    { t: 1, series_key: "a", series_kind: "erddap", count: 3 },
    { t: 2, series_key: "a", series_kind: "erddap", count: 4 },
    { t: 2, series_key: "b", series_kind: "erddap", count: 9 },
  ]);

  const res = await agent.get("/coverageHistogram").query({ count: "days" });

  assert.equal(res.status, 200);
  // One scan, where the entity counts take two.
  assert.equal(db.queries.length, 1);
  // Bins tile the window exactly, so a series' total IS the sum of its bars —
  // and the list is ranked descending, which is what the figure's top-N
  // selection reads.
  assert.deepEqual(res.body.series, [
    { key: "b", kind: "erddap", total: 9 },
    { key: "a", kind: "erddap", total: 7 },
  ]);
  assert.deepEqual(res.body.cells, [
    [1, "a", 3],
    [2, "a", 4],
    [2, "b", 9],
  ]);
});

test("the entity counts keep their own series query", async () => {
  for (const count of ["datasets", "features"]) {
    db.reset();
    resetCache();
    db.queueRaw([{ t: 1, series_key: "a", count: 2 }]);
    db.queueRaw([{ series_key: "a", series_kind: "erddap", total: 1 }]);

    const res = await agent.get("/coverageHistogram").query({ count });

    assert.equal(res.status, 200, count);
    // A distinct count is not additive across bins, so it cannot be folded out
    // of the bars the way days can: 1 dataset spanning 2 bins is not 2.
    assert.equal(db.queries.length, 2, count);
    assert.deepEqual(
      res.body.series,
      [{ key: "a", kind: "erddap", total: 1 }],
      count,
    );
  }
});

test("rejects an unknown count", async () => {
  const res = await agent.get("/coverageHistogram").query({ count: "bogus" });
  assert.equal(res.status, 400);
});
