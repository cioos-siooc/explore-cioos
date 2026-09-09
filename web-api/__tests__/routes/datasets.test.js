/**
 * GET /datasets
 *
 * Returns all datasets with title, pk, organization_pks, platform,
 * and title_translated (en/fr object) via a db.raw() SELECT.
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

describe("GET /datasets", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/datasets");
    expect(res.status).toBe(200);
  });

  it("queries the documented dataset fields in title order", async () => {
    await request(app).get("/datasets");
    const [sql] = db.raw.mock.calls[0];
    expect(sql).toContain("pk_url pk");
    expect(sql).toContain("json_build_object('en', title, 'fr', title_fr)");
    expect(sql).toContain("ORDER BY UPPER(title)");
  });
});
