/**
 * GET /erddapServers
 *
 * Returns a sorted array of distinct ERDDAP server URLs from cde.datasets.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const SERVER_ROWS = [
  { erddap_url: 'https://data.cioospacific.ca/erddap' },
  { erddap_url: 'https://erddap.cioos.ca/erddap' },
];

beforeEach(() => setRawRows(SERVER_ROWS));

describe('GET /erddapServers', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/erddapServers');
    expect(res.status).toBe(200);
  });

  it('returns an array of URL strings', async () => {
    const res = await request(app).get('/erddapServers');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toContain('https://data.cioospacific.ca/erddap');
    expect(res.body).toContain('https://erddap.cioos.ca/erddap');
  });

  it('returns empty array when no datasets exist', async () => {
    setRawRows([]);
    const res = await request(app).get('/erddapServers');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
