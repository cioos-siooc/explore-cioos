import { describe, it, expect } from "vitest";

import {
  GROUP_NONE,
  GRID_KEY,
  OTHER_KEY,
  UNCATEGORIZED_KEY,
  isGroupDimension,
  groupKeysFor,
  groupLabel,
  sortGroupKeys,
  groupParent,
  parentGroupKeys,
} from "./datasetGroups.js";

const t = (key) => key;

describe("isGroupDimension", () => {
  it("is false for GROUP_NONE and for a missing dimension", () => {
    expect(isGroupDimension(GROUP_NONE)).toBe(false);
    expect(isGroupDimension(undefined)).toBe(false);
  });

  it("is true for a filterable dimension", () => {
    expect(isGroupDimension("platform")).toBe(true);
  });

  it("is false for the in-view and selection groupings old links may name", () => {
    expect(isGroupDimension("inView")).toBe(false);
    expect(isGroupDimension("selected")).toBe(false);
  });
});

describe("groupKeysFor", () => {
  it("routes Grid datasets to GRID_KEY for type and platform, bypassing their real values", () => {
    const row = { cdm_data_type: "Grid", platform: "model" };
    expect(groupKeysFor(row, "type")).toEqual([GRID_KEY]);
    expect(groupKeysFor(row, "platform")).toEqual([GRID_KEY]);
  });

  it("falls back to OTHER_KEY for a missing type or platform", () => {
    expect(groupKeysFor({}, "type")).toEqual([OTHER_KEY]);
    expect(groupKeysFor({}, "platform")).toEqual([OTHER_KEY]);
  });

  it("groups by ERDDAP server or by each OBIS node for the source dimension", () => {
    expect(
      groupKeysFor({ erddap_server_url: "https://e/erddap" }, "source"),
    ).toEqual(["erddap:https://e/erddap"]);
    expect(
      groupKeysFor(
        { source_type: "obis", obis_nodes: ["OBIS Canada", "OTN-OBIS"] },
        "source",
      ),
    ).toEqual(["obis:OBIS Canada", "obis:OTN-OBIS"]);
    expect(groupKeysFor({ source_type: "obis" }, "source")).toEqual([
      `obis:${UNCATEGORIZED_KEY}`,
    ]);
  });

  it("returns every organization or eov a dataset belongs to (array-valued dimensions)", () => {
    expect(groupKeysFor({ organizations: [1, 2] }, "organization")).toEqual([
      1, 2,
    ]);
    expect(groupKeysFor({ organizations: [] }, "organization")).toEqual([
      UNCATEGORIZED_KEY,
    ]);
    expect(groupKeysFor({ eovs: ["salinity"] }, "eov")).toEqual(["salinity"]);
  });

  it("returns no keys for GROUP_NONE or an unrecognized dimension", () => {
    expect(groupKeysFor({}, GROUP_NONE)).toEqual([]);
    expect(groupKeysFor({}, "bogus")).toEqual([]);
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

  it("labels a type group with the geometry filter's words", () => {
    expect(groupLabel("TimeSeriesProfile", "type", t)).toBe(
      "layerTimeseriesProfile",
    );
    expect(groupLabel("TimeSeries", "type", t)).toBe("layerTimeseries");
    expect(groupLabel("Point", "type", t)).toBe("Point");
  });

  it("labels the source parents, servers by name and nodes as themselves", () => {
    expect(groupLabel("obis", "source", t)).toBe("OBIS");
    expect(groupLabel("erddap", "source", t)).toBe("ERDDAP");
    expect(
      groupLabel("erddap:https://erddap.ogsl.ca/erddap", "source", t, "fr"),
    ).toBe("OGSL");
    expect(groupLabel("obis:OTN-OBIS", "source", t)).toBe("OTN-OBIS");
    expect(groupLabel(`obis:${UNCATEGORIZED_KEY}`, "source", t)).toBe(
      "datasetsCardGroupUncategorizedText",
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

  it("does not mutate the input array", () => {
    const keys = ["b", "a"];
    sortGroupKeys(keys, "organization", t, "en");
    expect(keys).toEqual(["b", "a"]);
  });
});

describe("nested groups", () => {
  it("only the source dimension has parents", () => {
    expect(parentGroupKeys("source")).toEqual(["erddap", "obis"]);
    expect(parentGroupKeys("organization")).toEqual([]);
    expect(groupParent("erddap:https://e/erddap", "source")).toBe("erddap");
    expect(groupParent("obis", "source")).toBe(null);
    expect(groupParent("a:b", "eov")).toBe(null);
  });
});
