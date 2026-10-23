// The colour plot's rows as a heatmap grid: Plotly's own 1D-heatmap gridding
// keeps every distinct depth as a row, so casts sampled at their own depths
// would interleave into stripes of empty cells.
//
// Pure (no React, no Plotly), so every rule here is assertable under
// `node --test`.

const numberOf = (value, isTime) => {
  if (value === null || value === undefined || value === "") return null;
  const number = isTime ? Date.parse(value) : Number(value);
  return Number.isFinite(number) ? number : null;
};

// Every distinct value its own cell when they fit — one column per cast —
// otherwise `limit` equal-width bins, each placed at its centre.
function axisFor(values, limit) {
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length <= limit) {
    const cellByValue = new Map(distinct.map((value, cell) => [value, cell]));
    return { positions: distinct, cellOf: (value) => cellByValue.get(value) };
  }
  const low = distinct[0];
  const binWidth = (distinct[distinct.length - 1] - low) / limit;
  return {
    positions: Array.from(
      { length: limit },
      (_, cell) => low + binWidth * (cell + 0.5),
    ),
    cellOf: (value) =>
      Math.min(Math.floor((value - low) / binWidth), limit - 1),
  };
}

// Linear along Y between a column's own samples, never past its first or last
// one: below a shallow cast stays empty.
function fillColumnGaps(z, column, yPositions) {
  let previous = null;
  z.forEach((row, cell) => {
    if (row[column] === null) return;
    if (previous !== null && cell - previous > 1) {
      const low = z[previous][column];
      const span = yPositions[cell] - yPositions[previous];
      for (let gap = previous + 1; gap < cell; gap += 1) {
        const fraction = (yPositions[gap] - yPositions[previous]) / span;
        z[gap][column] = low + (row[column] - low) * fraction;
      }
    }
    previous = cell;
  });
}

/**
 * @param xValues, yValues  one raw value per row, as the data holds them
 * @param zValues           one number (or null) per row — the colour dimension
 * @param maxColumns, maxRows how many cells each axis may be cut into
 * @returns { x, y, z } with z[row][column], null cells empty; or null when
 *          either axis has fewer than two distinct values to spread over
 */
export function colorGridFor({
  xValues,
  yValues,
  zValues,
  xIsTime = false,
  yIsTime = false,
  maxColumns,
  maxRows,
}) {
  const samples = [];
  zValues.forEach((value, row) => {
    const x = numberOf(xValues[row], xIsTime);
    const y = numberOf(yValues[row], yIsTime);
    if (x === null || y === null || value === null || value === undefined) {
      return;
    }
    samples.push({ x, y, value });
  });
  const xAxis = axisFor(
    samples.map((sample) => sample.x),
    maxColumns,
  );
  const yAxis = axisFor(
    samples.map((sample) => sample.y),
    maxRows,
  );
  if (xAxis.positions.length < 2 || yAxis.positions.length < 2) return null;

  const emptyGrid = () =>
    yAxis.positions.map(() => xAxis.positions.map(() => 0));
  const sums = emptyGrid();
  const counts = emptyGrid();
  samples.forEach(({ x, y, value }) => {
    const row = yAxis.cellOf(y);
    const column = xAxis.cellOf(x);
    sums[row][column] += value;
    counts[row][column] += 1;
  });
  const z = sums.map((row, rowIndex) =>
    row.map((sum, column) =>
      counts[rowIndex][column] ? sum / counts[rowIndex][column] : null,
    ),
  );
  xAxis.positions.forEach((_, column) =>
    fillColumnGaps(z, column, yAxis.positions),
  );

  const asAxisValue = (isTime) => (position) =>
    isTime ? new Date(position).toISOString() : position;
  return {
    x: xAxis.positions.map(asAxisValue(xIsTime)),
    y: yAxis.positions.map(asAxisValue(yIsTime)),
    z,
  };
}
