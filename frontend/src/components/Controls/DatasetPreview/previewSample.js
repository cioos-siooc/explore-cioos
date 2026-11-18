// How much of the record the preview holds, for the note beside its title.
// Pure, so it is assertable under `node --test`.

/**
 * @param sample           /preview's { rowCount, totalRowCount }, if it sent one
 * @param rows             the rows as objects keyed by column name
 * @param profiles         /preview/profiles' { column, count }
 * @param drawsOneProfile  one chosen profile is drawn, so the rows are not a
 *                         sample OF the profiles
 * @returns null when the rows are the whole request, else the counts to show;
 *          the profile counts are null when they say nothing
 */
export function previewSampleFor({ sample, rows, profiles, drawsOneProfile }) {
  if (!sample || sample.rowCount >= sample.totalRowCount) return null;
  const column = profiles?.column;
  const countsProfiles =
    !drawsOneProfile &&
    profiles?.count > 1 &&
    rows.length > 0 &&
    column in rows[0];
  return {
    rowCount: sample.rowCount,
    totalRowCount: sample.totalRowCount,
    profileCount: countsProfiles
      ? new Set(rows.map((row) => row[column])).size
      : null,
    totalProfileCount: countsProfiles ? profiles.count : null,
  };
}

// Where the page before this one ends: the earliest instant among the rows, or
// null when none has a readable time.
export function earliestTime(rows) {
  let earliest = Infinity;
  rows.forEach((row) => {
    const time = Date.parse(row.time);
    if (time < earliest) earliest = time;
  });
  return earliest === Infinity ? null : new Date(earliest).toISOString();
}

/**
 * Which of the window controls the preview offers. Only a window of the record
 * gets any: one profile, or a record that came back whole at the default row
 * count, has nothing earlier to reach and no more rows to ask for. A period
 * fixes where the window is, so it can hold more rows but not page.
 */
export function previewWindowFor({
  sample,
  rows,
  drawsOneProfile,
  hasPeriod,
  before,
  rowLimitChanged,
}) {
  const partial = Boolean(sample) && sample.rowCount < sample.totalRowCount;
  const offersRows =
    !drawsOneProfile && (partial || Boolean(before) || rowLimitChanged);
  const earliest = offersRows && !hasPeriod ? earliestTime(rows) : null;
  return {
    offersRows,
    offersPaging: Boolean(earliest),
    earliest,
    startOfRecord: Boolean(sample?.startOfRecord),
  };
}
