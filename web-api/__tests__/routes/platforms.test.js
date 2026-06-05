/**
 * GET /platforms
 *
 * Returns an array of distinct platform name strings from cde.datasets.
 * NULL platforms are excluded by the WHERE clause in the SQL.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

beforeEach(() => setRawRows([{ platform: 'buoy' }, { platform: 'ship' }, { platform: 'mooring' }]));

describe('GET /platforms', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/platforms');
    expect(res.status).toBe(200);
  });

  it('returns an array of strings', async () => {
    const res = await request(app).get('/platforms');
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((p) => expect(typeof p).toBe('string'));
  });

  it('extracts the platform field from each row', async () => {
    const res = await request(app).get('/platforms');
    expect(res.body).toContain('buoy');
    expect(res.body).toContain('ship');
    expect(res.body).toContain('mooring');
  });

  it('returns empty array when no platforms exist', async () => {
    setRawRows([]);
    const res = await request(app).get('/platforms');
    expect(res.body).toEqual([]);
  });
});
