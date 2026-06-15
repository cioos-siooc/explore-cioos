/**
 * Factory helpers for mocking the Knex database client.
 *
 * Two shapes are needed:
 *   - db.raw(sql, params)  → resolves to { rows: [...] }
 *   - db("table")          → thenable chainable query builder
 *
 * Knex Raw objects also expose:
 *   - .sql         (the SQL string)
 *   - .toSQL()     (returns { sql, bindings })
 * Both are used by dbFilter.js and legend.js.
 */

/**
 * Build a mock for db.raw(sql, params).
 * Returns an object that is both awaitable and carries the Knex Raw metadata
 * that the application code inspects (.sql, .toSQL).
 */
function buildRawMock(rows = [], sql = 'SELECT 1') {
  return {
    rows,          // direct rows property (used by shapeQuery: rows.rows)
    sql,           // .sql property checked by shapeQuery.js
    toSQL: jest.fn(() => ({ sql, bindings: [] })),
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ rows }).then(onFulfilled, onRejected),
    catch: (onRejected) =>
      Promise.resolve({ rows }).catch(onRejected),
    toString: () => sql,
  };
}

/**
 * Build a mock for db("table") — a chainable, thenable query builder.
 * Every chaining method returns `this` so multi-call chains work.
 * When awaited, resolves to `rows`.
 */
function buildQueryBuilderMock(rows = []) {
  const qb = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    orderByRaw: jest.fn().mockReturnThis(),
    join: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue([1]),
    then: (onFulfilled, onRejected) =>
      Promise.resolve(rows).then(onFulfilled, onRejected),
    catch: (onRejected) =>
      Promise.resolve(rows).catch(onRejected),
  };
  return qb;
}

/**
 * Create a complete db mock.
 *
 * Usage in test files:
 *   jest.mock('../../db');
 *   const db = require('../../db');
 *   const { setRawRows, setTableRows } = setupDbMock(db);
 *   setRawRows([{ platform: 'buoy' }]);
 */
function setupDbMock(mockDb) {
  let rawRows = [];
  let tableRows = [];

  const rawMock = jest.fn((sql = 'SELECT 1') => buildRawMock(rawRows, sql));
  mockDb.mockImplementation(() => buildQueryBuilderMock(tableRows));
  mockDb.raw = rawMock;

  return {
    setRawRows: (rows) => { rawRows = rows; },
    setTableRows: (rows) => { tableRows = rows; },
    getRawMock: () => rawMock,
  };
}

module.exports = { buildRawMock, buildQueryBuilderMock, setupDbMock };
