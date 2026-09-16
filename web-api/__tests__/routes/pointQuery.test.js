/**
 * GET /pointQuery
 *
 * Delegates to getShapeQuery(req.query, doEstimate=false, getRecordsList=false).
 * No required parameters — filters are optional.
 */

jest.mock("../../db");
jest.mock("../../utils/cache", () => ({
  route: () => (_req, _res, next) => next(),
}));
jest.mock("../../utils/redis", () => ({
  connect: jest.fn().mockRejectedValue(new Error("no redis")),
}));
jest.mock("../../utils/shapeQuery");

const request = require("supertest");
const app = require("../../app");
const { getShapeQuery } = require("../../utils/shapeQuery");

beforeEach(() => {
  getShapeQuery.mockResolvedValue([]);
});

afterEach(() => jest.clearAllMocks());

describe("GET /pointQuery", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/pointQuery");
    expect(res.status).toBe(200);
  });

  it("calls getShapeQuery with doEstimate=false", async () => {
    await request(app).get("/pointQuery");
    expect(getShapeQuery).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      false,
    );
  });

  it("passes query params to getShapeQuery", async () => {
    await request(app).get(
      "/pointQuery?timeMin=2020-01-01T00:00:00Z&eovs=salinity",
    );
    const [query] = getShapeQuery.mock.calls[0];
    expect(query.timeMin).toBe("2020-01-01T00:00:00Z");
    expect(query.eovs).toBe("salinity");
  });
});
