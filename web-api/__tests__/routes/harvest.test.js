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
