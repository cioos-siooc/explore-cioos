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
