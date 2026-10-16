function buildRawMock(rows = [], sql = "SELECT 1") {
  return {
    rows,
    sql,
    toSQL: jest.fn(() => ({ sql, bindings: [] })),
    then: (onFulfilled, onRejected) =>
      Promise.resolve({ rows }).then(onFulfilled, onRejected),
    catch: (onRejected) => Promise.resolve({ rows }).catch(onRejected),
    toString: () => sql,
  };
}

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
    catch: (onRejected) => Promise.resolve(rows).catch(onRejected),
  };
  return qb;
}

// Usage: jest.mock('../../db'); const { setRawRows } = setupDbMock(require('../../db'));
function setupDbMock(mockDb) {
  let rawRows = [];
  let tableRows = [];

  const rawMock = jest.fn((sql = "SELECT 1") => buildRawMock(rawRows, sql));
  mockDb.mockImplementation(() => buildQueryBuilderMock(tableRows));
  mockDb.raw = rawMock;

  return {
    setRawRows: (rows) => {
      rawRows = rows;
    },
    setTableRows: (rows) => {
      tableRows = rows;
    },
    getRawMock: () => rawMock,
  };
}

module.exports = { buildRawMock, buildQueryBuilderMock, setupDbMock };
