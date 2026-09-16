/**
 * GET /platforms
 *
 * Returns an array of distinct platform name strings from cde.datasets.
 * NULL platforms are excluded by the WHERE clause in the SQL.
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

beforeEach(() =>
  setRawRows([
    { platform: "buoy" },
    { platform: "ship" },
    { platform: "mooring" },
  ]),
);

describe("GET /platforms", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/platforms");
    expect(res.status).toBe(200);
  });

  it("maps the database column to platform strings", async () => {
    const res = await request(app).get("/platforms");
    expect(res.body).toEqual(["buoy", "ship", "mooring"]);
  });

  it("queries distinct non-null platforms", async () => {
    await request(app).get("/platforms");
    const [sql] = db.raw.mock.calls[0];
    expect(sql).toContain("SELECT DISTINCT  platform");
    expect(sql).toContain("WHERE platform IS NOT NULL");
  });
});
