import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  GROUP_SIZE_SORT,
  pinnedPksOf,
  sortDatasets,
} from "./datasetSort.js";

const t = (key) => key;
const rows = [
  { pk: 1, title: "Bravo", days: 5, cdm_data_type: "TimeSeries" },
  { pk: 2, title: "alpha", days: 50, cdm_data_type: "TimeSeries" },
  { pk: 3, title: "Charlie", days: 1, cdm_data_type: "Grid" },
];
const pks = (sorted) => sorted.map((row) => row.pk);

describe("sortDatasets", () => {
  it("sorts strings case-insensitively and numbers numerically", () => {
    expect(
      pks(sortDatasets(rows, DEFAULT_SORT, { t, language: "en" })),
    ).toEqual([2, 1, 3]);
    expect(
      pks(
        sortDatasets(
          rows,
          { field: "days", dir: "desc" },
          { t, language: "en" },
        ),
      ),
    ).toEqual([2, 1, 3]);
    expect(
      pks(
        sortDatasets(
          rows,
          { field: "days", dir: "asc" },
          { t, language: "en" },
        ),
      ),
    ).toEqual([3, 1, 2]);
  });

  it("orders rows by title while the sort is the group size", () => {
    expect(
      pks(sortDatasets(rows, GROUP_SIZE_SORT, { t, language: "en" })),
    ).toEqual([2, 1, 3]);
  });

  it("puts map-click datasets first, then grids when asked, each block sorted", () => {
    expect(
      pks(
        sortDatasets(rows, DEFAULT_SORT, {
          pinnedPks: pinnedPksOf({ datasetPks: ["1"] }),
          gridFirst: true,
          t,
          language: "en",
        }),
      ),
    ).toEqual([1, 3, 2]);
  });

  it("puts catalogue records after every data-backed dataset, grids first included", () => {
    const record = { pk: 4, title: "Aardvark record", source_type: "ckan" };
    expect(
      pks(
        sortDatasets([record, ...rows], DEFAULT_SORT, {
          gridFirst: true,
          t,
          language: "en",
        }),
      ),
    ).toEqual([3, 2, 1, 4]);
  });

  it("does not reorder its input", () => {
    const input = [...rows];
    sortDatasets(input, DEFAULT_SORT, { t, language: "en" });
    expect(input).toEqual(rows);
  });
});

describe("pinnedPksOf", () => {
  it("is empty without a map click", () => {
    expect(pinnedPksOf(null).size).toBe(0);
    expect(pinnedPksOf({ datasetPks: [] }).size).toBe(0);
  });
});
