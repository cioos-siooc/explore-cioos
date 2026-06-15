/**
 * GET /scientificNames
 *
 * Typeahead lookup for OBIS scientific names with vernacular subtitles.
 * Two code paths:
 *   - ?names=A,B  — exact lookup for a list of scientific names
 *   - ?q=orca     — prefix/vernacular search
 */

jest.mock('../../db');
jest.mock('../../utils/cache', () => ({ route: () => (_req, _res, next) => next() }));
jest.mock('../../utils/redis', () => ({ connect: jest.fn().mockRejectedValue(new Error('no redis')) }));

const request = require('supertest');
const app = require('../../app');
const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');

const { setRawRows } = setupDbMock(db);

const RESULT_ROWS = [
  { scientificName: 'Orcinus orca', vernacular: 'killer whale', rank: 'Species' },
  { scientificName: 'Tursiops truncatus', vernacular: 'common bottlenose dolphin', rank: 'Species' },
];

beforeEach(() => setRawRows(RESULT_ROWS));

describe('GET /scientificNames', () => {
  describe('search by q', () => {
    it('returns 200', async () => {
      const res = await request(app).get('/scientificNames?q=orca');
      expect(res.status).toBe(200);
    });

    it('returns an array of { scientificName, vernacular, rank } objects', async () => {
      const res = await request(app).get('/scientificNames?q=Orcinus');
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('scientificName');
      expect(res.body[0]).toHaveProperty('vernacular');
      expect(res.body[0]).toHaveProperty('rank');
    });

    it('returns 200 with empty array when no results', async () => {
      setRawRows([]);
      const res = await request(app).get('/scientificNames?q=nonexistent');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns 400 for invalid q (special characters)', async () => {
      const res = await request(app).get('/scientificNames?q=<script>');
      expect(res.status).toBe(400);
    });

    it('accepts lang=fr parameter', async () => {
      const res = await request(app).get('/scientificNames?q=orque&lang=fr');
      expect(res.status).toBe(200);
    });

    it('returns 400 for unsupported lang value', async () => {
      const res = await request(app).get('/scientificNames?lang=de');
      expect(res.status).toBe(400);
    });
  });

  describe('exact lookup via names param', () => {
    it('returns 200 for exact names lookup', async () => {
      const res = await request(app).get('/scientificNames?names=Orcinus%20orca');
      expect(res.status).toBe(200);
    });

    it('returns matched rows when names are found', async () => {
      const res = await request(app).get('/scientificNames?names=Orcinus%20orca,Tursiops%20truncatus');
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('treats names= as no names param and falls through to search', async () => {
      setRawRows([]);
      const res = await request(app).get('/scientificNames?names=');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
