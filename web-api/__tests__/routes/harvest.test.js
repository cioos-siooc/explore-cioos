/**
 * GET /harvest/*
 *
 * The dashboard routes read cde.harvest_attempts, which is append-only and
 * gains a row per dataset per harvest run. Two properties matter here and are
 * invisible from the response alone, so they are asserted against the SQL:
 *
 *   - slug resolution must stay a plain indexable predicate, not a DISTINCT
 *     over the whole table (harvest_attempts_slug_idx in 1_schema.sql matches
 *     the expression character for character);
 *   - the per-dataset history must stay bounded, and must say so when it cuts.
 */

jest.mock("../../db");
jest.mock("../../utils/cache", () => ({
  route: () => (_req, _res, next) => next(),
  onlyOk: () => true,
}));
jest.mock("../../utils/redis", () => ({
  connect: jest.fn().mockRejectedValue(new Error("no redis")),
}));

const request = require("supertest");
const app = require("../../app");
const db = require("../../db");

// The harvest routes issue several db.raw calls per request with different
// shapes, so they get a queue keyed on what the SQL is asking for rather than
// the single shared row set setupDbMock provides.
let respond;

beforeEach(() => {
  db.mockImplementation(() => ({}));
  db.raw = jest.fn((sql, bindings) =>
    Promise.resolve({ rows: respond(sql, bindings) }),
  );
});

const sqlFor = (fragment) =>
  db.raw.mock.calls.find(([sql]) => sql.includes(fragment))?.[0];

// A bucket request issues two queries: the page, and a COUNT wrapped around
// the same template. Even a test that only reads the SQL has to answer the
// count with a row, or the route 500s reading `n` off an empty result.
// The count wrapper embeds the whole template, so a fragment search matches it
// too — and it is issued first. This picks the slicing query out of the pair.
const pageSqlFor = (fragment) =>
  db.raw.mock.calls.find(
    ([sql]) => sql.includes(fragment) && !sql.startsWith("SELECT count(*)"),
  )?.[0];

const bucketRows =
  (rows, total = rows.length) =>
  (sql) =>
    sql.startsWith("SELECT count(*)") ? [{ n: total }] : rows;

describe("GET /harvest/servers/:slug", () => {
  it("resolves the slug with an indexable predicate, not a table-wide DISTINCT", async () => {
    respond = (sql) =>
      sql.includes("translate(") ? [{ erddap_url: "https://e.ca/erddap" }] : [];

    await request(app).get("/harvest/servers/e-ca-erddap");

    const slugSql = sqlFor("translate(");
    expect(slugSql).toContain("FROM cde.harvest_attempts");
    // The whole point: no DISTINCT pass over the append-only table.
    expect(slugSql).not.toContain("DISTINCT");
    // The expression the index in 1_schema.sql is built on. If this changes,
    // that index silently stops being used.
    expect(slugSql).toContain(
      "regexp_replace(erddap_url, '^[a-z]+://', '', 'i')",
    );
    expect(slugSql).toContain("'./', '--'");
  });
});

describe("GET /harvest/servers", () => {
  it("takes each server's latest attempt with DISTINCT ON, not a correlated subquery", async () => {
    respond = () => [];

    const res = await request(app).get("/harvest/servers");

    expect(res.status).toBe(200);
    const sql = sqlFor("latest_run_per_server");
    expect(sql).toContain("DISTINCT ON (erddap_url, source)");
    // The pattern this replaced, and the one recentRuns was already moved off.
    expect(sql).not.toContain("FROM cde.harvest_attempts ha2");
  });
});

describe("GET /harvest/dataset/:slug/:datasetId", () => {
  const historyRow = (i) => ({
    run_id: `run-${i}`,
    attempted_at: `2026-01-0${(i % 9) + 1}T00:00:00Z`,
    status: "success",
  });

  // The route asks for one row beyond the cap to detect truncation, so a
  // fixture of exactly `limit` rows is the "not truncated" case and
  // `limit + 1` is the truncated one.
  const runWithHistoryOf = async (count) => {
    respond = (sql) => {
      if (sql.includes("translate(")) return [{ erddap_url: "https://e.ca" }];
      if (sql.includes("FROM cde.harvest_attempts a"))
        return Array.from({ length: count }, (_, i) => historyRow(i));
      return [{ content_hash: null }];
    };
    return request(app).get("/harvest/dataset/e-ca/some-dataset");
  };

  it("bounds the history query", async () => {
    await runWithHistoryOf(3);

    const sql = sqlFor("FROM cde.harvest_attempts a");
    expect(sql).toContain("LIMIT ?");
  });

  it("reports a short history as complete", async () => {
    const res = await runWithHistoryOf(3);

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(3);
    expect(res.body.historyTruncated).toBe(false);
  });

  it("trims to the cap and says it did", async () => {
    const res = await runWithHistoryOf(500);
    const { historyLimit } = res.body;

    expect(historyLimit).toBeGreaterThan(0);
    expect(res.body.history).toHaveLength(historyLimit);
    expect(res.body.historyTruncated).toBe(true);
  });

  it("404s a dataset with no attempts", async () => {
    const res = await runWithHistoryOf(0);

    expect(res.status).toBe(404);
  });
});

// The coverage routes diff three sets that each spell erddap_url differently
// and are each big enough to matter. Both properties are invisible from the
// response, so they are asserted against the SQL.
describe("GET /harvest/coverage", () => {
  it("normalises the trailing slash on every set it joins", async () => {
    respond = () => [];

    const res = await request(app).get("/harvest/coverage");

    expect(res.status).toBe(200);
    const sql = sqlFor("erddap_advertised");
    // harvest_config URLs carry a trailing slash, CKAN-derived ones do not, and
    // cde.datasets holds whichever the harvester was handed. Without the rtrim
    // on all three, a whole server reads as 100% uncovered.
    expect(sql).toContain("rtrim(erddap_url, '/')");
    expect(sql).toContain("FROM cde.datasets");
    expect(sql).toContain("FROM cde.ckan_records");
  });

  it("takes the latest attempt with an index-friendly DISTINCT ON", async () => {
    respond = () => [];

    await request(app).get("/harvest/coverage");

    const sql = sqlFor("erddap_advertised");
    // Over the raw column, so harvest_attempts_dataset_idx still applies — the
    // rtrim belongs in the projection, not the DISTINCT ON key.
    expect(sql).toContain("DISTINCT ON (erddap_url, dataset_id)");
    expect(sql).not.toContain("DISTINCT ON (rtrim(");
  });

  it("counts a hash-verified skip as present, not as a gap", async () => {
    respond = () => [];

    await request(app).get("/harvest/coverage");

    const sql = sqlFor("erddap_advertised");
    // UNCHANGED means "verified up to date"; reading it as a failure would
    // report every incremental run as hundreds of missing datasets.
    expect(sql).toContain("'UNCHANGED'");
    expect(sql).toContain("THEN 'success'");
  });

  it("returns both the summary row and the per-source rows", async () => {
    respond = (sql) =>
      sql.includes("GROUP BY adv.erddap_url")
        ? [
            {
              erddap_url: "https://e.ca/erddap",
              source: "erddap",
              n_advertised: 9,
            },
          ]
        : [{ n_app_total: 5, n_erddap_not_in_app: 2 }];

    const res = await request(app).get("/harvest/coverage");

    expect(res.body.summary.n_app_total).toBe(5);
    expect(res.body.sources).toHaveLength(1);
  });
});

describe("GET /harvest/coverage/:bucket", () => {
  const runBucketOf = async (
    count,
    bucket = "erddap-not-in-app",
    query = "",
  ) => {
    respond = bucketRows(
      Array.from({ length: count }, (_, i) => ({ dataset_id: `ds_${i}` })),
      3533,
    );
    return request(app).get(`/harvest/coverage/${bucket}${query}`);
  };

  it("bounds the bucket query to one page", async () => {
    await runBucketOf(3);

    expect(pageSqlFor("erddap_advertised e")).toContain("LIMIT ? OFFSET ?");
  });

  it("returns the page beside the total the list runs to", async () => {
    const res = await runBucketOf(3);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.total).toBe(3533);
    expect(res.body.offset).toBe(0);
  });

  it("counts the whole set, not the page", async () => {
    await runBucketOf(3, "erddap-not-in-app", "?page=4");

    const countSql = sqlFor("SELECT count(*)");
    // The wrapper must carry the template's own filtering but none of the
    // page's slicing, or the total would come back equal to the page size and
    // the pager would stop after one step.
    expect(countSql).toContain("erddap_advertised e");
    expect(countSql).not.toContain("LIMIT");
  });

  it("keeps the search term on both the page and its count", async () => {
    // A search that narrowed the rows but not the total would leave the pager
    // offering pages that come back empty.
    await runBucketOf(3, "erddap-not-in-app", "?q=orphan");

    for (const [sql, bindings] of db.raw.mock.calls) {
      if (!sql.includes("erddap_advertised e")) continue;
      expect(bindings.slice(0, 2)).toEqual(["orphan", "orphan"]);
    }
  });

  it("404s an unknown bucket instead of returning an empty list", async () => {
    // An empty list would read as "no gaps here", which is the opposite of
    // "no such report".
    const res = await runBucketOf(0, "not-a-bucket");

    expect(res.status).toBe(404);
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("classifies a CKAN record whose server CDE never harvests", async () => {
    respond = bucketRows([]);

    await request(app).get("/harvest/coverage/ckan-not-in-app");

    const sql = sqlFor("classification");
    expect(sql).toContain("'server_not_harvested'");
    expect(sql).toContain("'not_advertised'");
    expect(sql).toContain("'harvest_failed'");
  });
});

describe("coverage source_type handling", () => {
  it("treats a NULL source_type as ERDDAP, not as neither", async () => {
    respond = () => [];

    await request(app).get("/harvest/coverage");

    const sql = sqlFor("erddap_advertised");
    // cde.datasets.source_type is nullable and real databases carry NULL on
    // ERDDAP rows. `source_type <> 'obis'` yields NULL for those, silently
    // dropping every ERDDAP dataset and reporting the whole catalogue as
    // missing from CDE — observed against a live database before this guard.
    expect(sql).not.toMatch(/source_type\s*<>\s*'obis'/);
    expect(sql).toMatch(/source_type IS DISTINCT FROM 'obis'/);
  });
});

describe("coverage list/count agreement", () => {
  it("joins one CKAN record per dataset so a list cannot outgrow its count", async () => {
    respond = bucketRows([]);

    await request(app).get("/harvest/coverage/erddap-not-in-app");

    const sql = sqlFor("erddap_advertised e");
    // Several CKAN records can describe the same ERDDAP dataset. Joining the
    // raw ckan set fanned one dataset into one row per record — observed as a
    // 113-row list under a count that said 94.
    expect(sql).toContain("LEFT JOIN ckan_erddap_one");
    expect(sql).toMatch(/DISTINCT ON \(erddap_url, dataset_id\)[\s\S]*ckan_id/);
  });

  it("counts CKAN-not-in-CDE over records, matching what that bucket lists", async () => {
    respond = () => [];

    await request(app).get("/harvest/coverage");

    const sql = sqlFor("n_ckan_not_in_app");
    // The bucket is record-centric (it shows ckan_id/ckan_name), so counting
    // distinct datasets there understated the list it heads.
    expect(sql).toMatch(/FROM ckan c\s+WHERE c\.erddap_url IS NOT NULL/);
  });
});
