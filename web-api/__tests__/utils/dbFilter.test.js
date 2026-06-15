/**
 * Unit tests for utils/dbFilter.js — createDBFilter
 *
 * createDBFilter(query) translates req.query parameters into a Knex Raw object
 * containing a SQL WHERE clause fragment and bindings.
 *
 * We mock db so that db.raw(sql, params) is captured and we can assert on the
 * generated SQL template and parameter object without hitting PostgreSQL.
 */

jest.mock('../../db');

const db = require('../../db');
const { setupDbMock } = require('../helpers/mockDb');
const createDBFilter = require('../../utils/dbFilter');

// Capture what db.raw is called with
let lastSql = '';
let lastParams = {};

beforeEach(() => {
  db.mockImplementation(() => ({}));
  db.raw = jest.fn((sql, params) => {
    lastSql = sql || '';
    lastParams = params || {};
    return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
  });
});

afterEach(() => jest.clearAllMocks());

describe('createDBFilter', () => {
  it('returns an object with a sql property', () => {
    const result = createDBFilter({});
    expect(result).toHaveProperty('sql');
  });

  it('produces empty SQL for an empty query', () => {
    createDBFilter({});
    expect(lastSql).toBe('');
  });

  it('adds eovs filter with && operator', () => {
    createDBFilter({ eovs: 'seaSurfaceTemperature,salinity' });
    expect(lastSql).toContain('eovs &&');
    expect(lastParams.eovsCommaSeparatedString).toEqual(['seaSurfaceTemperature', 'salinity']);
  });

  it('deduplicates eov values', () => {
    createDBFilter({ eovs: 'salinity,salinity' });
    expect(lastParams.eovsCommaSeparatedString).toEqual(['salinity']);
  });

  it('adds timeMin filter with timestamptz cast', () => {
    createDBFilter({ timeMin: '2020-01-01T00:00:00Z' });
    expect(lastSql).toContain('time_max >= :timeMin::timestamptz');
    expect(lastParams.timeMin).toBe('2020-01-01T00:00:00Z');
  });

  it('adds timeMax filter with timestamptz cast', () => {
    createDBFilter({ timeMax: '2023-12-31T00:00:00Z' });
    expect(lastSql).toContain('time_min <= :timeMax::timestamptz');
    expect(lastParams.timeMax).toBe('2023-12-31T00:00:00Z');
  });

  it('adds latMin / latMax filters', () => {
    createDBFilter({ latMin: '45', latMax: '55' });
    expect(lastSql).toContain('latitude >= (:latMin)::double precision');
    expect(lastSql).toContain('latitude <= (:latMax)::double precision');
  });

  it('adds lonMin / lonMax filters', () => {
    createDBFilter({ lonMin: '-130', lonMax: '-120' });
    expect(lastSql).toContain('longitude >= (:lonMin)::double precision');
    expect(lastSql).toContain('longitude <= (:lonMax)::double precision');
  });

  it('adds depthMin / depthMax filters', () => {
    createDBFilter({ depthMin: '0', depthMax: '200' });
    expect(lastSql).toContain('depth_max >= (:depthMin)::integer');
    expect(lastSql).toContain('depth_min <= (:depthMax)::integer');
  });

  it('adds datasetPKs filter with ANY', () => {
    createDBFilter({ datasetPKs: '1,2,3' });
    expect(lastSql).toContain('d.pk_url = ANY (:datasetPKs)');
    expect(lastParams.datasetPKs).toEqual(['1', '2', '3']);
  });

  it('adds organizations filter with && operator', () => {
    createDBFilter({ organizations: '10,20' });
    expect(lastSql).toContain('organization_pks && :organizationsString');
  });

  it('adds polygon filter with ST_Contains', () => {
    const polygon = JSON.stringify([[-130, 45], [-120, 45], [-120, 55], [-130, 55], [-130, 45]]);
    createDBFilter({ polygon });
    expect(lastSql).toContain('ST_Contains');
    expect(lastParams.wktPolygon).toMatch(/^POLYGON\(/);
  });

  it('joins multiple filters with AND', () => {
    createDBFilter({ timeMin: '2020-01-01T00:00:00Z', timeMax: '2023-12-31T00:00:00Z' });
    expect(lastSql).toContain('AND');
  });
});
