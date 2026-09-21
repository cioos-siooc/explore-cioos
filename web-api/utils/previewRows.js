/*
 * Which rows survive when ERDDAP returns more than the preview can show.
 *
 * /preview asks ERDDAP for a time window sized to yield about `limit` rows and
 * deliberately sets no upper bound, so anything the dataset has added since the
 * last harvest comes back too. The newest rows are the whole point, so a
 * head-slice would throw away exactly what the caller wanted.
 *
 * Taking the tail instead is only correct once the rows are in time order, and
 * tabledap does not promise one -- row order follows the source files. Sorting
 * here rather than asking ERDDAP for `&orderBy("time")` keeps the upstream
 * request unchanged (no compatibility surface, no extra server-side work) and
 * gives a defined tie order, which orderBy does not: Array#sort is stable, so
 * rows sharing a timestamp keep ERDDAP's own sequence. That matters because the
 * plot draws `lines` in row order, and a profile's rows at one instant are its
 * depth sequence.
 */

/**
 * Trim `table.rows` to at most `limit` rows, preferring the most recent, and
 * leaving `table` otherwise untouched. Mutates and returns `table`.
 */
function trimPreviewRows(table, limit) {
  const rows = table?.rows;
  if (!Array.isArray(rows) || rows.length <= limit) return table;

  const timeIndex = (table.columnNames || []).indexOf("time");
  if (timeIndex < 0) {
    // Nothing to order by: keep the original behaviour rather than guessing.
    table.rows = rows.slice(0, limit);
    return table;
  }

  // Decorate-sort-undecorate: one Date.parse per row instead of one per
  // comparison. Unparseable times sort first, so they are the rows dropped.
  const decorated = rows.map((row, index) => {
    const parsed = Date.parse(row[timeIndex]);
    return { row, index, time: Number.isNaN(parsed) ? -Infinity : parsed };
  });
  decorated.sort((a, b) => a.time - b.time || a.index - b.index);

  // A record sampled at a single instant (one cast) has no "latest" rows. Its
  // row order is the depth sequence, so keep the shallow end, not the deep one.
  if (decorated[0].time === decorated[decorated.length - 1].time) {
    table.rows = rows.slice(0, limit);
    return table;
  }

  table.rows = decorated.slice(-limit).map((entry) => entry.row);
  return table;
}

module.exports = { trimPreviewRows };
