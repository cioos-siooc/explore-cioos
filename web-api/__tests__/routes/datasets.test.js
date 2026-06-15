/**
 * GET /datasets
 *
 * Returns all datasets with title, pk, organization_pks, platform,
 * and title_translated (en/fr object) via a db.raw() SELECT.
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const DATASETS = [
  {
    title: 'Ocean Temperature Survey',
    pk: 'pk-1',
    pk_url: 'pk-1',
    organization_pks: [1, 2],
    platform: 'buoy',
    title_translated: { en: 'Ocean Temperature Survey', fr: 'Relevé de température océanique' },
  },
  {
    title: 'Salinity Monitoring',
    pk: 'pk-2',
    pk_url: 'pk-2',
    organization_pks: [3],
    platform: 'ship',
    title_translated: { en: 'Salinity Monitoring', fr: 'Surveillance de la salinité' },
  },
];

beforeEach(() => setRawRows(DATASETS));

describe('GET /datasets', () => {
  it('returns 200', async () => {
    const res = await request(app).get('/datasets');
    expect(res.status).toBe(200);
  });

  it('returns an array', async () => {
    const res = await request(app).get('/datasets');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('each row has required fields', async () => {
    const res = await request(app).get('/datasets');
    const [first] = res.body;
    expect(first).toHaveProperty('title');
    expect(first).toHaveProperty('organization_pks');
    expect(first).toHaveProperty('platform');
    expect(first).toHaveProperty('title_translated');
  });

  it('title_translated is an object with en and fr keys', async () => {
    const res = await request(app).get('/datasets');
    const { title_translated } = res.body[0];
    expect(title_translated).toHaveProperty('en');
    expect(title_translated).toHaveProperty('fr');
  });

  it('returns empty array when no datasets', async () => {
    setRawRows([]);
    const res = await request(app).get('/datasets');
    expect(res.body).toEqual([]);
  });
});
