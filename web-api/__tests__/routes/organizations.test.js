/**
 * GET /organizations
 *
 * Returns every organization ordered by name (case-insensitive).
 * Uses db("cde.organizations").orderByRaw("UPPER(name)") — the chainable Knex API.
 * changePKtoPkURL maps pk_url → pk on each row.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setTableRows } = setupDbMock(db);

const ORGS = [
  { pk_url: 'abc123', name: 'CIOOS Pacific' },
  { pk_url: 'def456', name: 'CIOOS Atlantic' },
];

beforeEach(() => setTableRows(ORGS));

describe('GET /organizations', () => {
  it('returns 200 with an array', async () => {
    const res = await request(app).get('/organizations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('maps pk_url to pk on each row', async () => {
    const res = await request(app).get('/organizations');
    expect(res.body[0].pk).toBe('abc123');
    expect(res.body[1].pk).toBe('def456');
  });

  it('preserves name field', async () => {
    const res = await request(app).get('/organizations');
    const names = res.body.map((o) => o.name);
    expect(names).toContain('CIOOS Pacific');
    expect(names).toContain('CIOOS Atlantic');
  });

  it('calls orderByRaw for case-insensitive sorting', async () => {
    await request(app).get('/organizations');
    const qb = db.mock.results[0].value;
    expect(qb.orderByRaw).toHaveBeenCalledWith('UPPER(name)');
  });

  it('returns empty array when no organizations exist', async () => {
    setTableRows([]);
    const res = await request(app).get('/organizations');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
