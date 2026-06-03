/**
 * GET /download
 *
 * Creates a download job when datasets are found for the given filters.
 * Validation via requiredShapeMiddleware (shape checks) and express-validator (email).
 *
 * NOTE: The email check (`check("email").isEmail()`) in the route registers a
 * validator but the async handler never calls validationResult(), so invalid
 * email addresses are NOT rejected at the HTTP layer — this is a known source-code
 * gap documented in docs/technical_debt.md.  Tests below assert actual behaviour.
 *
 * Shape validation rejects partial bounding boxes (some but not all of
 * latMin/latMax/lonMin/lonMax supplied).
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));
jest.mock('../../utils/shapeQuery');

// dbFilter returns a mock Raw object that serialises cleanly in template literals
jest.mock('../../utils/dbFilter', () =>
  jest.fn(() => ({
    sql: 'TRUE',
    toString: () => 'TRUE',
    toSQL: jest.fn(() => ({ sql: 'TRUE', bindings: [] })),
  })),
);

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { getShapeQuery } = require('../../utils/shapeQuery');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

// Simulate a successful db.raw response with two matching datasets
const MATCHING_DATASETS = [
  {
    erddap_url: 'https://erddap.example.com/erddap',
    dataset_id: 'test_ds_001',
    title: 'Test Dataset',
    profile_variables: ['station_id'],
    cdm_data_type: 'TimeSeries',
    ckan_id: 'ckan-uuid-1',
  },
];

const BASE_QUERY = {
  email: 'user@example.com',
  latMin: '45',
  latMax: '55',
  lonMin: '-130',
  lonMax: '-120',
};

beforeEach(() => {
  setRawRows([{ json_agg: MATCHING_DATASETS }]);
  getShapeQuery.mockResolvedValue([{ pk_url: 'ds-1', dataset_id: 'test_ds_001', size: 1000 }]);
});

afterEach(() => jest.clearAllMocks());

describe('GET /download — happy path', () => {
  it('returns 200 when datasets are found', async () => {
    const res = await request(app).get('/download').query(BASE_QUERY);
    expect(res.status).toBe(200);
  });

  it('returns { count: N } matching the number of datasets', async () => {
    const res = await request(app).get('/download').query(BASE_QUERY);
    expect(res.body).toHaveProperty('count', 1);
  });

  it('inserts a row into cde.download_jobs', async () => {
    await request(app).get('/download').query(BASE_QUERY);
    const qb = db.mock.results.find((r) => r.value?.insert);
    expect(qb?.value?.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        downloader_input: expect.any(Object),
      }),
    );
  });

  it('does not insert a download job when no datasets match', async () => {
    // json_agg=null means the SELECT found no matching profiles/datasets.
    // The job should NOT be queued.
    // Note: `count` in download.js is an implicit global (undeclared variable),
    // so its value when json_agg is null depends on prior calls in the same
    // process — this is a known tech-debt item. We assert the observable
    // side-effect (no DB insert) rather than the stale count value.
    setRawRows([{ json_agg: null }]);
    const insertMock = jest.fn().mockResolvedValue([1]);
    db.mockReturnValue({ insert: insertMock, orderByRaw: jest.fn().mockReturnThis() });

    const res = await request(app).get('/download').query(BASE_QUERY);
    expect(res.status).toBe(200);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

describe('GET /download — shape validation', () => {
  it('returns 400 when only latMin is provided (partial bounding box)', async () => {
    const res = await request(app)
      .get('/download')
      .query({ email: 'user@example.com', latMin: '45' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for partial bounding box with three of four coords', async () => {
    const res = await request(app)
      .get('/download')
      .query({ email: 'user@example.com', latMin: '45', latMax: '55', lonMin: '-130' }); // missing lonMax
    expect(res.status).toBe(400);
  });

  it('accepts request with no shape (all filters optional)', async () => {
    // shape validation passes when neither polygon nor lat/lon bounds are given
    const res = await request(app).get('/download').query({ email: 'user@example.com' });
    expect(res.status).toBe(200);
  });

  it('accepts a valid polygon', async () => {
    const polygon = JSON.stringify([[-130, 45], [-120, 45], [-120, 55], [-130, 55], [-130, 45]]);
    const res = await request(app)
      .get('/download')
      .query({ email: 'user@example.com', polygon });
    expect(res.status).toBe(200);
  });
});

describe('GET /download — error handling', () => {
  it('returns 404 with error message when db.raw throws', async () => {
    db.raw = jest.fn().mockRejectedValue(new Error('DB connection lost'));
    const res = await request(app).get('/download').query(BASE_QUERY);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
