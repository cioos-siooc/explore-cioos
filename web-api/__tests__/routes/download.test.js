jest.mock("../../db");
jest.mock("../../utils/cache", () => ({
  route: () => (_req, _res, next) => next(),
}));
jest.mock("../../utils/redis", () => ({
  connect: jest.fn().mockRejectedValue(new Error("no redis")),
}));
jest.mock("../../utils/shapeQuery");

jest.mock("../../utils/dbFilter", () =>
  jest.fn(() => ({
    sql: "TRUE",
    toString: () => "TRUE",
    toSQL: jest.fn(() => ({ sql: "TRUE", bindings: [] })),
  })),
);

const request = require("supertest");
const app = require("../../app");
const db = require("../../db");
const { getShapeQuery } = require("../../utils/shapeQuery");
const { setupDbMock } = require("../helpers/mockDb");

const { setRawRows } = setupDbMock(db);

const MATCHING_DATASETS = [
  {
    erddap_url: "https://erddap.example.com/erddap",
    dataset_id: "test_ds_001",
    title: "Test Dataset",
    profile_variables: ["station_id"],
    cdm_data_type: "TimeSeries",
    ckan_id: "ckan-uuid-1",
  },
];

const EMAIL = { email: "user@example.com" };

const BASE_QUERY = {
  latMin: "45",
  latMax: "55",
  lonMin: "-130",
  lonMax: "-120",
};

beforeEach(() => {
  setRawRows([{ json_agg: MATCHING_DATASETS }]);
  getShapeQuery.mockResolvedValue([
    { pk_url: "ds-1", dataset_id: "test_ds_001", size: 1000 },
  ]);
});

afterEach(() => jest.clearAllMocks());

describe("POST /download — happy path", () => {
  it("returns 200 when datasets are found", async () => {
    const res = await request(app)
      .post("/download")
      .query(BASE_QUERY)
      .send(EMAIL);
    expect(res.status).toBe(200);
  });

  it("returns { count: N } matching the number of datasets", async () => {
    const res = await request(app)
      .post("/download")
      .query(BASE_QUERY)
      .send(EMAIL);
    expect(res.body).toHaveProperty("count", 1);
  });

  it("inserts a row into cde.download_jobs", async () => {
    await request(app).post("/download").query(BASE_QUERY).send(EMAIL);
    const qb = db.mock.results.find((r) => r.value?.insert);
    expect(qb?.value?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "user@example.com",
        email_domain: "example.com",
        downloader_input: expect.any(Object),
      }),
    );
  });

  it("records the domain in lower case, for statistics that outlive the address", async () => {
    await request(app)
      .post("/download")
      .query(BASE_QUERY)
      .send({ email: "Someone@DFO-MPO.gc.ca" });
    const qb = db.mock.results.find((r) => r.value?.insert);
    expect(qb?.value?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ email_domain: "dfo-mpo.gc.ca" }),
    );
  });

  it("does not insert a download job when no datasets match", async () => {
    setRawRows([{ json_agg: null }]);
    const insertMock = jest.fn().mockResolvedValue([1]);
    db.mockReturnValue({
      insert: insertMock,
      orderByRaw: jest.fn().mockReturnThis(),
    });

    const res = await request(app)
      .post("/download")
      .query(BASE_QUERY)
      .send(EMAIL);
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe("POST /download — shape validation", () => {
  it("returns 400 when only latMin is provided (partial bounding box)", async () => {
    const res = await request(app)
      .post("/download")
      .query({ latMin: "45" })
      .send(EMAIL);
    expect(res.status).toBe(400);
  });

  it("returns 400 for partial bounding box with three of four coords", async () => {
    const res = await request(app)
      .post("/download")
      .query({ latMin: "45", latMax: "55", lonMin: "-130" }) // missing lonMax
      .send(EMAIL);
    expect(res.status).toBe(400);
  });

  it("accepts request with no shape (all filters optional)", async () => {
    const res = await request(app).post("/download").send(EMAIL);
    expect(res.status).toBe(200);
  });

  it("accepts a valid polygon", async () => {
    const polygon = JSON.stringify([
      [-130, 45],
      [-120, 45],
      [-120, 55],
      [-130, 55],
      [-130, 45],
    ]);
    const res = await request(app)
      .post("/download")
      .query({ polygon })
      .send(EMAIL);
    expect(res.status).toBe(200);
  });
});

describe("POST /download — error handling", () => {
  it("returns 500 with error message when db.raw throws", async () => {
    db.raw = jest.fn().mockRejectedValue(new Error("DB connection lost"));
    const res = await request(app)
      .post("/download")
      .query(BASE_QUERY)
      .send(EMAIL);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
  });
});
