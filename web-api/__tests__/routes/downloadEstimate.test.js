/**
 * GET /downloadEstimate
 *
 * No required parameters. Delegates to getShapeQuery(req.query, doEstimate=true).
 * Returns [{ pk, dataset_id, size }] for each matching dataset.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));
jest.mock('../../utils/shapeQuery');

const request = require('supertest');
const app = require('../../app');
const { getShapeQuery } = require('../../utils/shapeQuery');

const ESTIMATE_RESULT = [
  { pk_url: 'ds-1', dataset_id: 'test_ds_001', size: 1048576, title: 'Test Dataset' },
  { pk_url: 'ds-2', dataset_id: 'test_ds_002', size: 2097152, title: 'Another Dataset' },
];

beforeEach(() => getShapeQuery.mockResolvedValue(ESTIMATE_RESULT));
afterEach(() => jest.clearAllMocks());

describe('GET /downloadEstimate', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/downloadEstimate');
    expect(res.status).toBe(200);
  });

  it('returns an array', async () => {
    const res = await request(app).get('/downloadEstimate');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('maps pk_url → pk, keeps dataset_id and size', async () => {
    const res = await request(app).get('/downloadEstimate');
    const [first] = res.body;
    expect(first.pk).toBe('ds-1');
    expect(first.dataset_id).toBe('test_ds_001');
    expect(first.size).toBe(1048576);
    // title is not part of the exposed shape
    expect(first).not.toHaveProperty('pk_url');
  });

  it('calls getShapeQuery with doEstimate=true', async () => {
    await request(app).get('/downloadEstimate');
    expect(getShapeQuery).toHaveBeenCalledWith(
      expect.any(Object),
      true,
      false,
    );
  });

  it('passes filter params to getShapeQuery', async () => {
    await request(app).get('/downloadEstimate?datasetPKs=1,2&timeMin=2020-01-01T00:00:00Z');
    const [query] = getShapeQuery.mock.calls[0];
    expect(query.datasetPKs).toBe('1,2');
    expect(query.timeMin).toBe('2020-01-01T00:00:00Z');
  });

  it('returns empty array when no matching datasets', async () => {
    getShapeQuery.mockResolvedValue([]);
    const res = await request(app).get('/downloadEstimate');
    expect(res.body).toEqual([]);
  });
});
