import { describe, it, expect } from "vitest";

import {
  GROUP_NONE,
  GRID_KEY,
  OTHER_KEY,
  UNCATEGORIZED_KEY,
  IN_VIEW_KEY,
  OUT_OF_VIEW_KEY,
  SELECTED_KEY,
  UNSELECTED_KEY,
  isGroupDimension,
  groupKeysFor,
  groupLabel,
  sortGroupKeys,
  hiddenDatasetPksFor,
} from "./datasetGroups.js";

const t = (key) => key;

describe("isGroupDimension", () => {
  it("is false for GROUP_NONE and for a missing dimension", () => {
    expect(isGroupDimension(GROUP_NONE)).toBe(false);
    expect(isGroupDimension(undefined)).toBe(false);
  });

  it("is true for any other dimension", () => {
    expect(isGroupDimension("platform")).toBe(true);
  });
});

describe("groupKeysFor", () => {
  it("routes Grid datasets to GRID_KEY for type and platform, bypassing their real values", () => {
    const row = { cdm_data_type: "Grid", platform: "model" };
    expect(groupKeysFor(row, "type", null)).toEqual([GRID_KEY]);
    expect(groupKeysFor(row, "platform", null)).toEqual([GRID_KEY]);
  });

  it("falls back to OTHER_KEY for a missing type or platform", () => {
    expect(groupKeysFor({}, "type", null)).toEqual([OTHER_KEY]);
    expect(groupKeysFor({}, "platform", null)).toEqual([OTHER_KEY]);
  });

  it("groups by source_type for the source dimension, defaulting to erddap", () => {
    expect(groupKeysFor({ source_type: "obis" }, "source", null)).toEqual([
      "obis",
    ]);
    expect(groupKeysFor({}, "source", null)).toEqual(["erddap"]);
  });

  it("returns every organization or eov a dataset belongs to (array-valued dimensions)", () => {
    expect(
      groupKeysFor({ organizations: [1, 2] }, "organization", null),
    ).toEqual([1, 2]);
    expect(groupKeysFor({ organizations: [] }, "organization", null)).toEqual([
      UNCATEGORIZED_KEY,
    ]);
    expect(groupKeysFor({ eovs: ["salinity"] }, "eov", null)).toEqual([
      "salinity",
    ]);
  });

  it("groups by map-viewport membership for inView", () => {
    const inView = new Set([1]);
    expect(groupKeysFor({ pk: 1 }, "inView", inView)).toEqual([IN_VIEW_KEY]);
    expect(groupKeysFor({ pk: 2 }, "inView", inView)).toEqual([
      OUT_OF_VIEW_KEY,
    ]);
  });

  it("groups by selection state for selected", () => {
    expect(groupKeysFor({ selected: true }, "selected", null)).toEqual([
      SELECTED_KEY,
    ]);
    expect(groupKeysFor({ selected: false }, "selected", null)).toEqual([
      UNSELECTED_KEY,
    ]);
  });

  it("returns no keys for GROUP_NONE or an unrecognized dimension", () => {
    expect(groupKeysFor({}, GROUP_NONE, null)).toEqual([]);
    expect(groupKeysFor({}, "bogus", null)).toEqual([]);
  });
});

describe("groupLabel", () => {
  it("translates the sentinel keys regardless of the active dimension", () => {
    expect(groupLabel(GRID_KEY, "type", t)).toBe("griddapTypeLabel");
    expect(groupLabel(OTHER_KEY, "type", t)).toBe("datasetsCardGroupOtherText");
    expect(groupLabel(UNCATEGORIZED_KEY, "organization", t)).toBe(
      "datasetsCardGroupUncategorizedText",
    );
  });

  it("spaces out a compound cdm_data_type for the type dimension", () => {
    expect(groupLabel("TimeSeriesProfile", "type", t)).toBe(
      "Time series / Profile",
    );
    expect(groupLabel("TimeSeries", "type", t)).toBe("Time series");
  });

  it("uppercases OBIS but title-cases ERDDAP for the source dimension", () => {
    expect(groupLabel("obis", "source", t)).toBe("OBIS");
    expect(groupLabel("erddap", "source", t)).toBe("ERDDAP");
  });

  it("translates the in/out-of-view and selected/unselected labels", () => {
    expect(groupLabel(IN_VIEW_KEY, "inView", t)).toBe(
      "datasetsCardOnlyInViewText",
    );
    expect(groupLabel(OUT_OF_VIEW_KEY, "inView", t)).toBe(
      "datasetsCardGroupOutOfViewText",
    );
    expect(groupLabel(SELECTED_KEY, "selected", t)).toBe(
      "datasetsCardGroupInSelectionText",
    );
    expect(groupLabel(UNSELECTED_KEY, "selected", t)).toBe(
      "datasetsCardGroupNotInSelectionText",
    );
  });

  it("returns the raw key for organization/eov, which have no translation", () => {
    expect(groupLabel("Fisheries and Oceans Canada", "organization", t)).toBe(
      "Fisheries and Oceans Canada",
    );
  });
});

describe("sortGroupKeys", () => {
  it("alphabetizes by label, pinning Other/Uncategorized last", () => {
    const keys = ["Zebra Org", OTHER_KEY, "Alpha Org"];
    expect(sortGroupKeys(keys, "organization", t, "en")).toEqual([
      "Alpha Org",
      "Zebra Org",
      OTHER_KEY,
    ]);
  });

  it("puts the dimension's own first key ahead of alphabetical order", () => {
    const keys = [OUT_OF_VIEW_KEY, IN_VIEW_KEY];
    expect(sortGroupKeys(keys, "inView", t, "en")).toEqual([
      IN_VIEW_KEY,
      OUT_OF_VIEW_KEY,
    ]);
  });

  it("does not mutate the input array", () => {
    const keys = ["b", "a"];
    sortGroupKeys(keys, "organization", t, "en");
    expect(keys).toEqual(["b", "a"]);
  });
});

describe("hiddenDatasetPksFor", () => {
  const datasets = [
    { pk: 1, organizations: [1] },
    { pk: 2, organizations: [1, 2] },
    { pk: 3, organizations: [2] },
  ];

  it("hides nothing without a group dimension or an empty hidden set", () => {
    expect(
      hiddenDatasetPksFor(datasets, GROUP_NONE, new Set([1]), null).size,
    ).toBe(0);
    expect(
      hiddenDatasetPksFor(datasets, "organization", new Set(), null).size,
    ).toBe(0);
  });

  it("hides a dataset only when every one of its groups is hidden", () => {
    const hidden = hiddenDatasetPksFor(
      datasets,
      "organization",
      new Set([1]),
      null,
    );
    // pk 1 is only in org 1 (hidden) -> hidden. pk 2 is in org 1 AND 2 (2 is
    // still shown) -> stays. pk 3 is only in org 2 (shown) -> stays.
    expect(hidden).toEqual(new Set([1]));
  });

  it("hides a dataset that belongs to several groups, all hidden", () => {
    const hidden = hiddenDatasetPksFor(
      datasets,
      "organization",
      new Set([1, 2]),
      null,
    );
    expect(hidden).toEqual(new Set([1, 2, 3]));
  });
});
