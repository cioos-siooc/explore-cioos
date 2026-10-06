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
  db.queueRaw([{ min: null, max: null }]);
  db.queueRaw([]);

  await agent.get("/coverageHistogram").query({ count: "days" });

  // The extent the bins are fitted to, then the one binned scan.
  assert.equal(db.queries.length, 2);
  assert.doesNotMatch(db.queries[1], /day_range_overlap_days/);
  // The merge that replaced it, and the binary search over the bin edges that
  // replaced comparing every feature against every bin.
  assert.match(db.queries[1], /starts_island/);
  assert.match(db.queries[1], /width_bucket/);
});

test("the days count answers the series totals from the bars, in one query", async () => {
  db.queueRaw([{ min: null, max: null }]);
  db.queueRaw([
    { t: 1, series_key: "a", series_kind: "erddap", count: 3 },
    { t: 2, series_key: "a", series_kind: "erddap", count: 4 },
    { t: 2, series_key: "b", series_kind: "erddap", count: 9 },
  ]);

  const res = await agent.get("/coverageHistogram").query({ count: "days" });

  assert.equal(res.status, 200);
  // One binned scan after the extent, where the entity counts take two.
  assert.equal(db.queries.length, 2);
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
    db.queueRaw([{ min: null, max: null }]);
    db.queueRaw([{ t: 1, series_key: "a", count: 2 }]);
    db.queueRaw([{ series_key: "a", series_kind: "erddap", total: 1 }]);

    const res = await agent.get("/coverageHistogram").query({ count });

    assert.equal(res.status, 200, count);
    // A distinct count is not additive across bins, so it cannot be folded out
    // of the bars the way days can: 1 dataset spanning 2 bins is not 2.
    assert.equal(db.queries.length, 3, count);
    assert.deepEqual(
      res.body.series,
      [{ key: "a", kind: "erddap", total: 1 }],
      count,
    );
  }
});

test("the bins span the selection's data, not 1900 to now", async () => {
  db.queueRaw([{ min: "2012-03-17T00:00:00Z", max: "2019-06-01T00:00:00Z" }]);
  db.queueRaw([]);

  const res = await agent.get("/coverageHistogram").query({ count: "days" });

  const edges = res.body.timeBinEdges;
  assert.equal(edges[0].slice(0, 10), "2012-03-17");
  assert.ok(edges.at(-1) >= "2019-06-02", edges.at(-1));
  assert.ok(edges.at(-1) < "2020", edges.at(-1));
});

test("year-wide bins open on Jan 1, but never before the time filter", async () => {
  db.queueRaw([{ min: "1905-07-01T00:00:00Z", max: "2020-01-01T00:00:00Z" }]);
  db.queueRaw([]);
  let res = await agent.get("/coverageHistogram").query({ count: "days" });
  assert.equal(res.body.timeBinEdges[0].slice(0, 10), "1905-01-01");

  db.reset();
  resetCache();
  db.queueRaw([{ min: "1905-07-01T00:00:00Z", max: "2020-01-01T00:00:00Z" }]);
  db.queueRaw([]);
  res = await agent
    .get("/coverageHistogram")
    .query({ count: "days", timeMin: "1905-03-01" });
  assert.equal(res.body.timeBinEdges[0].slice(0, 10), "1905-03-01");
});

test("rejects an unknown count", async () => {
  const res = await agent.get("/coverageHistogram").query({ count: "bogus" });
  assert.equal(res.status, 400);
});

test("the seasonal view folds real calendar bins into 52 weeks of the year", async () => {
  db.queueRaw([{ min: "2010-01-01T00:00:00Z", max: "2014-12-31T00:00:00Z" }]);
  db.queueRaw([]);

  const res = await agent
    .get("/coverageHistogram")
    .query({ count: "days", view: "seasonal", timeMin: "2011-03-10" });

  assert.equal(res.status, 200);
  assert.equal(res.body.view, "seasonal");
  // Reported in a reference year, so the figure draws 52 week bars.
  const edges = res.body.timeBinEdges;
  assert.equal(edges.length, 53);
  assert.equal(edges[0].slice(0, 10), "2001-01-01");
  assert.equal(edges[51].slice(0, 10), "2001-12-24");
  assert.equal(edges[52].slice(0, 10), "2002-01-01");

  // The real bins start at the time filter, not the Jan 1 or week boundary
  // before it, or days the filter excludes would be counted. Mar 10 is in the
  // week opening Mar 5 (the 10th), and Dec 24 always folds into the last week.
  const sql = db.queries[1];
  assert.match(sql, /\{"2011-03-10","2011-03-12",/);
  assert.match(sql, /'\{10,11,/);
  assert.match(sql, /"2011-12-24","2012-01-01"/);
  assert.match(sql, /,52,1,2,/);
});

test("the entity counts fold before they count distinct", async () => {
  db.queueRaw([{ min: "2010-01-01T00:00:00Z", max: "2014-12-31T00:00:00Z" }]);
  db.queueRaw([]);
  db.queueRaw([]);

  await agent
    .get("/coverageHistogram")
    .query({ count: "datasets", view: "seasonal" });

  // A span longer than a year is expanded across one year of bins at most
  // before it is folded into weeks.
  assert.match(
    db.queries[1],
    /SELECT DISTINCT entity, series_key,\s+\(\(SELECT grp/,
  );
  assert.match(db.queries[1], /tb0 \+ \(51\)::integer/);
});

test("rejects an unknown view", async () => {
  const res = await agent.get("/coverageHistogram").query({ view: "bogus" });
  assert.equal(res.status, 400);
});
