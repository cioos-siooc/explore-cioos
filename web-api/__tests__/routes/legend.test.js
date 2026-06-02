/**
 * GET /legend
 *
 * Returns { recordsCount: { zoom0, zoom1, zoom2 } } for map legend rendering.
 * Accepts optional filter params (timeMin, timeMax, etc.).
 * Uses validatorMiddleware() so invalid filter params return 400.
 *
 * db.raw() is mocked; the SQL template is never executed.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const LEGEND_ROW = { zoom0: [1, 42], zoom1: [1, 105], zoom2: [1, 350] };

beforeEach(() => setRawRows([LEGEND_ROW]));
afterEach(() => jest.clearAllMocks());

describe('GET /legend', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/legend');
    expect(res.status).toBe(200);
  });

  it('returns recordsCount with zoom0, zoom1, zoom2', async () => {
    const res = await request(app).get('/legend');
    expect(res.body).toHaveProperty('recordsCount');
    const { recordsCount } = res.body;
    expect(recordsCount).toHaveProperty('zoom0');
    expect(recordsCount).toHaveProperty('zoom1');
    expect(recordsCount).toHaveProperty('zoom2');
  });

  it('each zoom level is an array of two numbers', async () => {
    const res = await request(app).get('/legend');
    const { recordsCount } = res.body;
    ['zoom0', 'zoom1', 'zoom2'].forEach((z) => {
      expect(Array.isArray(recordsCount[z])).toBe(true);
      expect(recordsCount[z]).toHaveLength(2);
    });
  });

  it('passes timeMin filter through without error', async () => {
    const res = await request(app).get('/legend?timeMin=2020-01-01T00:00:00Z');
    expect(res.status).toBe(200);
  });

  it('rejects invalid timeMin with 400', async () => {
    const res = await request(app).get('/legend?timeMin=not-a-date');
    expect(res.status).toBe(400);
  });

  it('rejects non-integer depthMin with 400', async () => {
    const res = await request(app).get('/legend?depthMin=abc');
    expect(res.status).toBe(400);
  });
});
