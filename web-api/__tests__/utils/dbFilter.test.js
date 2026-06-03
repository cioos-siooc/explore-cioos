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

// ---------------------------------------------------------------------------
// OBIS-specific filter params
// These use a separate beforeEach because the scientificNames path calls
// db.raw twice (expansion query + the final shared/obisOnly pair), requiring
// a thenable mock for the first call.
// ---------------------------------------------------------------------------

function makeRawMock(firstCallRows = []) {
  const calls = [];
  const mock = jest.fn((sql, params) => {
    calls.push({ sql: sql || '', params: params || {} });
    if (calls.length === 1 && firstCallRows !== null) {
      // First call: expansion query — must be awaitable and return { rows }
      return Promise.resolve({ rows: firstCallRows });
    }
    return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
  });
  mock.calls = calls;
  return mock;
}

describe('createDBFilter — obisNodes filter', () => {
  beforeEach(() => {
    db.mockImplementation(() => ({}));
    db.raw = jest.fn((sql, params) => ({ sql: sql || '', params, toSQL: () => ({ sql, bindings: [] }) }));
  });
  afterEach(() => jest.clearAllMocks());

  it('adds obisNodes filter with && operator', async () => {
    const rawCalls = [];
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });
    await createDBFilter({ obisNodes: 'EurOBIS,OBIS-Canada' });
    expect(rawCalls[0].sql).toContain('d.obis_nodes && :obisNodesArr');
    expect(rawCalls[0].params.obisNodesArr).toEqual(['EurOBIS', 'OBIS-Canada']);
  });

  it('sets hasShared=true for obisNodes filter', async () => {
    db.raw = jest.fn((sql) => ({ sql: sql || '', toSQL: () => ({ sql, bindings: [] }) }));
    const result = await createDBFilter({ obisNodes: 'EurOBIS' });
    expect(result.hasShared).toBe(true);
  });
});

describe('createDBFilter — erddapServers filter', () => {
  beforeEach(() => {
    db.mockImplementation(() => ({}));
    db.raw = jest.fn((sql, params) => ({ sql: sql || '', params, toSQL: () => ({ sql, bindings: [] }) }));
  });
  afterEach(() => jest.clearAllMocks());

  it('adds erddapServers filter with ANY', async () => {
    const rawCalls = [];
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });
    await createDBFilter({ erddapServers: 'https://erddap.cioos.ca/erddap,https://data.cioospacific.ca/erddap' });
    expect(rawCalls[0].sql).toContain('d.erddap_url = ANY(:erddapServersArray)');
    expect(rawCalls[0].params.erddapServersArray).toEqual([
      'https://erddap.cioos.ca/erddap',
      'https://data.cioospacific.ca/erddap',
    ]);
  });

  it('sets hasShared=true for erddapServers filter', async () => {
    db.raw = jest.fn((sql) => ({ sql: sql || '', toSQL: () => ({ sql, bindings: [] }) }));
    const result = await createDBFilter({ erddapServers: 'https://erddap.cioos.ca/erddap' });
    expect(result.hasShared).toBe(true);
  });
});

describe('createDBFilter — scientificNames filter', () => {
  const { ScientificNameSelectionTooBroadError, MAX_EXPANDED_APHIA_IDS } = require('../../utils/dbFilter');

  afterEach(() => jest.clearAllMocks());

  it('runs expansion query and adds obisOnly filter', async () => {
    const rawCalls = [];
    db.mockImplementation(() => ({}));
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      if (rawCalls.length === 1) {
        return Promise.resolve({ rows: [{ aphia_id: 123 }, { aphia_id: 456 }] });
      }
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });

    const result = await createDBFilter({ scientificNames: 'Orcinus orca' });
    // First call is the expansion query
    expect(rawCalls[0].sql).toContain('scientific_name_vernaculars');
    expect(rawCalls[0].params.scientificNamesArr).toEqual(['Orcinus orca']);
    // obisOnly SQL should contain the combined AphiaID + name match
    expect(result.hasObisOnly).toBe(true);
  });

  it('passes expandedAphiaIds and scientificNamesArr to the obisOnly filter', async () => {
    const rawCalls = [];
    db.mockImplementation(() => ({}));
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      if (rawCalls.length === 1) {
        return Promise.resolve({ rows: [{ aphia_id: 99 }] });
      }
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });

    await createDBFilter({ scientificNames: 'Gadus morhua' });
    // Second call is shared (TRUE), third is obisOnly
    const obisCall = rawCalls[2];
    expect(obisCall.params.expandedAphiaIds).toEqual([99]);
    expect(obisCall.params.scientificNamesArr).toEqual(['Gadus morhua']);
    expect(obisCall.sql).toContain('aphia_ids && :expandedAphiaIds');
  });

  it('deduplicates scientific name values', async () => {
    const rawCalls = [];
    db.mockImplementation(() => ({}));
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      if (rawCalls.length === 1) {
        return Promise.resolve({ rows: [] });
      }
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });

    await createDBFilter({ scientificNames: 'Gadus morhua,Gadus morhua' });
    expect(rawCalls[0].params.scientificNamesArr).toEqual(['Gadus morhua']);
  });

  it('throws ScientificNameSelectionTooBroadError when expansion exceeds cap', async () => {
    db.mockImplementation(() => ({}));
    const bigRows = Array.from({ length: MAX_EXPANDED_APHIA_IDS + 1 }, (_, i) => ({ aphia_id: i + 1 }));
    db.raw = jest.fn((sql, params) => {
      return Promise.resolve({ rows: bigRows });
    });

    await expect(createDBFilter({ scientificNames: 'Animalia' }))
      .rejects.toBeInstanceOf(ScientificNameSelectionTooBroadError);
  });

  it('ScientificNameSelectionTooBroadError has statusCode 400', async () => {
    db.mockImplementation(() => ({}));
    const bigRows = Array.from({ length: MAX_EXPANDED_APHIA_IDS + 1 }, (_, i) => ({ aphia_id: i + 1 }));
    db.raw = jest.fn(() => Promise.resolve({ rows: bigRows }));

    try {
      await createDBFilter({ scientificNames: 'Animalia' });
      fail('expected throw');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.expandedCount).toBeGreaterThan(MAX_EXPANDED_APHIA_IDS);
    }
  });

  it('non-integer aphia_ids are filtered out before cap check', async () => {
    const rawCalls = [];
    db.mockImplementation(() => ({}));
    // Mix valid ints with null/string — should filter to just the int
    db.raw = jest.fn((sql, params) => {
      rawCalls.push({ sql: sql || '', params: params || {} });
      if (rawCalls.length === 1) {
        return Promise.resolve({ rows: [{ aphia_id: 7 }, { aphia_id: null }, { aphia_id: 'bad' }] });
      }
      return { sql: sql || '', toSQL: () => ({ sql: sql || '', bindings: [] }) };
    });

    const result = await createDBFilter({ scientificNames: 'Orcinus orca' });
    const obisCall = rawCalls[2];
    expect(obisCall.params.expandedAphiaIds).toEqual([7]);
  });
});
