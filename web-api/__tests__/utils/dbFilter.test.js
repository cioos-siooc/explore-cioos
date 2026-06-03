/**
 * Unit tests for utils/dbFilter.js — createDBFilter
 *
 * createDBFilter is async; it returns { shared, obisOnly, hasShared, hasObisOnly }.
 * db.raw is called twice per invocation (once for shared filters, once for obisOnly).
 * We capture both calls and assert on the first (shared) call for non-OBIS filters.
 */

jest.mock('../../db');

const db = require('../../db');
const createDBFilter = require('../../utils/dbFilter');

let rawCalls = [];

beforeEach(() => {
  rawCalls = [];
  db.mockImplementation(() => ({}));
  db.raw = jest.fn((sql, params) => {
    rawCalls.push({ sql: sql || '', params: params || {} });
    return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
  });
});

afterEach(() => jest.clearAllMocks());

describe('createDBFilter', () => {
  it('returns an object with shared/obisOnly/hasShared/hasObisOnly properties', async () => {
    const result = await createDBFilter({});
    expect(result).toHaveProperty('shared');
    expect(result).toHaveProperty('obisOnly');
    expect(result).toHaveProperty('hasShared');
    expect(result).toHaveProperty('hasObisOnly');
  });

  it('produces TRUE SQL and hasShared=false for an empty query', async () => {
    const result = await createDBFilter({});
    expect(result.hasShared).toBe(false);
    expect(rawCalls[0].sql).toBe('TRUE');
  });

  it('adds eovs filter with && operator', async () => {
    await createDBFilter({ eovs: 'seaSurfaceTemperature,salinity' });
    expect(rawCalls[0].sql).toContain('eovs &&');
    expect(rawCalls[0].params.eovsCommaSeparatedString).toEqual(['seaSurfaceTemperature', 'salinity']);
  });

  it('deduplicates eov values', async () => {
    await createDBFilter({ eovs: 'salinity,salinity' });
    expect(rawCalls[0].params.eovsCommaSeparatedString).toEqual(['salinity']);
  });

  it('adds timeMin filter with timestamptz cast', async () => {
    await createDBFilter({ timeMin: '2020-01-01T00:00:00Z' });
    expect(rawCalls[0].sql).toContain('time_max >= :timeMin::timestamptz');
    expect(rawCalls[0].params.timeMin).toBe('2020-01-01T00:00:00Z');
  });

  it('adds timeMax filter with timestamptz cast', async () => {
    await createDBFilter({ timeMax: '2023-12-31T00:00:00Z' });
    expect(rawCalls[0].sql).toContain('time_min <= :timeMax::timestamptz');
    expect(rawCalls[0].params.timeMax).toBe('2023-12-31T00:00:00Z');
  });

  it('adds latMin / latMax filters', async () => {
    await createDBFilter({ latMin: '45', latMax: '55' });
    expect(rawCalls[0].sql).toContain('latitude >= (:latMin)::double precision');
    expect(rawCalls[0].sql).toContain('latitude <= (:latMax)::double precision');
  });

  it('adds lonMin / lonMax filters', async () => {
    await createDBFilter({ lonMin: '-130', lonMax: '-120' });
    expect(rawCalls[0].sql).toContain('longitude >= (:lonMin)::double precision');
    expect(rawCalls[0].sql).toContain('longitude <= (:lonMax)::double precision');
  });

  it('adds depthMin / depthMax filters', async () => {
    await createDBFilter({ depthMin: '0', depthMax: '200' });
    expect(rawCalls[0].sql).toContain('depth_max >= (:depthMin)::integer');
    expect(rawCalls[0].sql).toContain('depth_min <= (:depthMax)::integer');
  });

  it('adds datasetPKs filter with ANY', async () => {
    await createDBFilter({ datasetPKs: '1,2,3' });
    expect(rawCalls[0].sql).toContain('d.pk_url = ANY (:datasetPKs)');
    expect(rawCalls[0].params.datasetPKs).toEqual(['1', '2', '3']);
  });

  it('adds organizations filter with && operator', async () => {
    await createDBFilter({ organizations: '10,20' });
    expect(rawCalls[0].sql).toContain('organization_pks && :organizationsString');
  });

  it('adds polygon filter with ST_Contains', async () => {
    const polygon = JSON.stringify([[-130, 45], [-120, 45], [-120, 55], [-130, 55], [-130, 45]]);
    await createDBFilter({ polygon });
    expect(rawCalls[0].sql).toContain('ST_Contains');
    expect(rawCalls[0].params.wktPolygon).toMatch(/^POLYGON\(/);
  });

  it('joins multiple filters with AND', async () => {
    await createDBFilter({ timeMin: '2020-01-01T00:00:00Z', timeMax: '2023-12-31T00:00:00Z' });
    expect(rawCalls[0].sql).toContain('AND');
  });

  it('sets hasShared=true when at least one filter is active', async () => {
    const result = await createDBFilter({ eovs: 'salinity' });
    expect(result.hasShared).toBe(true);
  });
});
