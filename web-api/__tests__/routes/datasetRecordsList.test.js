/**
 * GET /datasetRecordsList
 *
 * Requires query param `datasetPKs` (integer).
 * Returns a single dataset object with profile list.
 * Uses datasetDetailsMiddleware() which validates datasetPKs is an integer.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));
jest.mock('../../utils/shapeQuery');

const request = require('supertest');
const app = require('../../app');
const { getShapeQuery } = require('../../utils/shapeQuery');

const RECORD_DETAILS = {
  pk: 'ds-1',
  pk_url: 'ds-1',
  dataset_id: 'test_ds_001',
  title: 'Test Dataset',
  profiles: [
    { profile_id: 'PROF-1', time_min: '2020-01-01', time_max: '2022-12-31', depth_min: 0, depth_max: 200 },
  ],
};

beforeEach(() => getShapeQuery.mockResolvedValue([RECORD_DETAILS]));
afterEach(() => jest.clearAllMocks());

describe('GET /datasetRecordsList', () => {
  it('returns 200 with a valid integer datasetPKs', async () => {
    const res = await request(app).get('/datasetRecordsList?datasetPKs=42');
    expect(res.status).toBe(200);
  });

  it('returns the single dataset object (pop of results array)', async () => {
    const res = await request(app).get('/datasetRecordsList?datasetPKs=42');
    expect(res.body).toHaveProperty('dataset_id', 'test_ds_001');
  });

  it('returns 400 when datasetPKs is missing', async () => {
    const res = await request(app).get('/datasetRecordsList');
    expect(res.status).toBe(400);
  });

  it('returns 400 when datasetPKs is not an integer', async () => {
    const res = await request(app).get('/datasetRecordsList?datasetPKs=abc');
    expect(res.status).toBe(400);
  });

  it('calls getShapeQuery with getRecordsList=true', async () => {
    await request(app).get('/datasetRecordsList?datasetPKs=42');
    expect(getShapeQuery).toHaveBeenCalledWith(
      expect.any(Object),
      false,
      true,
    );
  });

  it('passes timeMin filter alongside datasetPKs', async () => {
    await request(app).get('/datasetRecordsList?datasetPKs=42&timeMin=2021-01-01T00:00:00Z');
    const [query] = getShapeQuery.mock.calls[0];
    expect(query.timeMin).toBe('2021-01-01T00:00:00Z');
    expect(query.datasetPKs).toBe('42');
  });
});
