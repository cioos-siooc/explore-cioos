/**
 * GET /oceanVariables
 *
 * Returns an array of distinct ocean variable name strings
 * by unnesting the eovs array column across all datasets.
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

const EOV_ROWS = [
  { ocean_variables: "seaSurfaceTemperature" },
  { ocean_variables: "salinity" },
  { ocean_variables: "oxygen" },
];

beforeEach(() => setRawRows(EOV_ROWS));

describe("GET /oceanVariables", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/oceanVariables");
    expect(res.status).toBe(200);
  });

  it("maps the database column to variable strings", async () => {
    const res = await request(app).get("/oceanVariables");
    expect(res.body).toEqual(["seaSurfaceTemperature", "salinity", "oxygen"]);
  });

  it("queries distinct EOV values", async () => {
    await request(app).get("/oceanVariables");
    expect(db.raw.mock.calls[0][0]).toContain(
      "SELECT DISTINCT UNNEST(eovs) ocean_variables",
    );
  });
});
