// /preview sets no upper time bound so rows added since the harvest come back;
// the newest rows are the point, so keep the tail. tabledap row order follows
// the source files, so sort here (stable: rows sharing a timestamp keep
// ERDDAP's order, which for a profile is its depth sequence).
function trimPreviewRows(table, limit) {
  const rows = table?.rows;
  if (!Array.isArray(rows) || rows.length <= limit) return table;

  const timeIndex = (table.columnNames || []).indexOf("time");
  if (timeIndex < 0) {
    table.rows = rows.slice(0, limit);
    return table;
  }

  // Unparseable times sort first, so they are the rows dropped.
  const decorated = rows.map((row, index) => {
    const parsed = Date.parse(row[timeIndex]);
    return { row, index, time: Number.isNaN(parsed) ? -Infinity : parsed };
  });
  decorated.sort((a, b) => a.time - b.time || a.index - b.index);

  // A single-instant record (one cast): keep the shallow end of its depth
  // sequence.
  if (decorated[0].time === decorated[decorated.length - 1].time) {
    table.rows = rows.slice(0, limit);
    return table;
  }

  table.rows = decorated.slice(-limit).map((entry) => entry.row);
  return table;
}

module.exports = { trimPreviewRows };
