/**
 * GET /oceanVariables
 *
 * Returns an array of distinct ocean variable name strings
 * by unnesting the eovs array column across all datasets.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const EOV_ROWS = [
  { ocean_variables: 'seaSurfaceTemperature' },
  { ocean_variables: 'salinity' },
  { ocean_variables: 'oxygen' },
];

beforeEach(() => setRawRows(EOV_ROWS));

describe('GET /oceanVariables', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/oceanVariables');
    expect(res.status).toBe(200);
  });

  it('returns an array of strings', async () => {
    const res = await request(app).get('/oceanVariables');
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((v) => expect(typeof v).toBe('string'));
  });

  it('extracts the ocean_variables field from each row', async () => {
    const res = await request(app).get('/oceanVariables');
    expect(res.body).toContain('seaSurfaceTemperature');
    expect(res.body).toContain('salinity');
    expect(res.body).toContain('oxygen');
  });

  it('returns empty array when no EOVs exist', async () => {
    setRawRows([]);
    const res = await request(app).get('/oceanVariables');
    expect(res.body).toEqual([]);
  });
});
