/**
 * GET /scientificNames
 *
 * Typeahead lookup for OBIS scientific names with vernacular subtitles.
 * Two code paths:
 *   - ?names=A,B  — exact lookup for a list of scientific names
 *   - ?q=orca     — prefix/vernacular search
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
afterEach(() => jest.clearAllMocks());

describe("GET /scientificNames", () => {
  describe("search by q", () => {
    it("returns 200", async () => {
      const res = await request(app).get("/scientificNames?q=orca");
      expect(res.status).toBe(200);
    });

    it("binds q as both a scientific-name prefix and vernacular substring", async () => {
      await request(app).get("/scientificNames?q=Orcinus&limit=10");
      const [sql, bindings] = db.raw.mock.calls[0];
      expect(sql).toContain("n.scientific_name ILIKE :prefix");
      expect(sql).toContain("WHERE vn ILIKE :sub");
      expect(bindings).toEqual({
        q: "Orcinus",
        prefix: "Orcinus%",
        sub: "%Orcinus%",
        limit: 10,
      });
    });

    it("returns 400 for invalid q (special characters)", async () => {
      const res = await request(app).get("/scientificNames?q=<script>");
      expect(res.status).toBe(400);
    });

    it("selects French vernaculars when lang=fr", async () => {
      await request(app).get("/scientificNames?q=orque&lang=fr");
      expect(db.raw.mock.calls[0][0]).toContain("v.vernaculars_fr");
    });

    it("returns 400 for unsupported lang value", async () => {
      const res = await request(app).get("/scientificNames?lang=de");
      expect(res.status).toBe(400);
    });
  });

  describe("exact lookup via names param", () => {
    it("binds exact names as an array", async () => {
      await request(app).get(
        "/scientificNames?names=Orcinus%20orca,Tursiops%20truncatus",
      );
      const [sql, bindings] = db.raw.mock.calls[0];
      expect(sql).toContain("n.scientific_name = ANY(:names)");
      expect(bindings).toEqual({
        names: ["Orcinus orca", "Tursiops truncatus"],
      });
    });

    it("treats names= as a search request", async () => {
      await request(app).get("/scientificNames?names=");
      const [sql, bindings] = db.raw.mock.calls[0];
      expect(sql).toContain("n.scientific_name ILIKE :prefix");
      expect(bindings.q).toBe("");
    });
  });
});
