/**
 * GET /obisNodes
 *
 * Returns a sorted array of { name } objects for distinct OBIS nodes
 * from cde.datasets rows where source_type = 'obis'.
 */

jest.mock("../../db");
jest.mock("../../utils/cache", () => ({
  route: () => (_req, _res, next) => next(),
}));
jest.mock("../../utils/redis", () => ({
  connect: jest.fn().mockRejectedValue(new Error("no redis")),
}));

const request = require("supertest");
const app = require("../../app");
const db = require("../../db");
const { setupDbMock } = require("../helpers/mockDb");

const { setRawRows } = setupDbMock(db);

beforeEach(() => setRawRows([]));

describe("GET /obisNodes", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/obisNodes");
    expect(res.status).toBe(200);
  });

  it("queries distinct non-null nodes from OBIS datasets in name order", async () => {
    await request(app).get("/obisNodes");
    const [sql] = db.raw.mock.calls[0];
    expect(sql).toContain("SELECT DISTINCT unnest(obis_nodes) AS name");
    expect(sql).toContain("source_type = 'obis'");
    expect(sql).toContain("obis_nodes IS NOT NULL");
    expect(sql).toContain("ORDER BY name");
  });
});
