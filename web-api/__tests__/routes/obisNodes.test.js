/**
 * GET /obisNodes
 *
 * Returns a sorted array of { name } objects for distinct OBIS nodes
 * from cde.datasets rows where source_type = 'obis'.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const NODE_ROWS = [
  { name: 'EurOBIS' },
  { name: 'OBIS-Canada' },
];

beforeEach(() => setRawRows(NODE_ROWS));

describe('GET /obisNodes', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/obisNodes');
    expect(res.status).toBe(200);
  });

  it('returns an array of { name } objects', async () => {
    const res = await request(app).get('/obisNodes');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body.map((r) => r.name)).toContain('EurOBIS');
    expect(res.body.map((r) => r.name)).toContain('OBIS-Canada');
  });

  it('returns empty array when no OBIS datasets exist', async () => {
    setRawRows([]);
    const res = await request(app).get('/obisNodes');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
