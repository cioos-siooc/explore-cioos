import { describe, expect, it, vi } from "vitest";

import { buildPortals, setLeaves } from "./portals.js";

const server = (pk, url, extra) => ({ pk, url, title: url, ...extra });

describe("buildPortals", () => {
  it("gives a CKAN owner the servers it claims, with ids matching the filter model", () => {
    const [slgo] = buildPortals({
      erddapServersSelected: [server(0, "https://a"), server(1, "https://b")],
      portalOwners: [
        {
          pk: "SLGO",
          title: "SLGO",
          erddapServers: ["https://a", "https://b"],
        },
      ],
      obisCataloguesSelected: [{ pk: "SLGO", title: "SLGO" }],
    });
    expect(slgo.leaves.map((l) => [l.id, l.label])).toEqual([
      ["erddap-0", "ERDDAP: https://a"],
      ["erddap-1", "ERDDAP: https://b"],
      ["obiscat-SLGO", "OBIS"],
    ]);
  });

  it("reads include or exclude only when every leaf has it", () => {
    const portal = (servers) =>
      buildPortals({ erddapServersSelected: servers })[0];
    expect(portal([server(0, "https://a", { isSelected: true })]).state).toBe(
      "include",
    );
    expect(portal([server(0, "https://a", { isExcluded: true })]).state).toBe(
      "exclude",
    );
  });

  it("leaves out OBIS with no nodes, and an owner with neither servers nor OBIS records", () => {
    expect(
      buildPortals({
        obisNodesSelected: [],
        portalOwners: [{ pk: "X", title: "X", erddapServers: [] }],
      }),
    ).toEqual([]);
  });
});

describe("setLeaves", () => {
  it("updates each list once, touching only the given leaves", () => {
    const setA = vi.fn();
    const setB = vi.fn();
    setLeaves(
      [
        { option: { pk: 1 }, setList: setA },
        { option: { pk: 2 }, setList: setA },
        { option: { pk: "x" }, setList: setB },
      ],
      "exclude",
    );
    expect(setA).toHaveBeenCalledTimes(1);
    expect(setA.mock.calls[0][0]([{ pk: 1 }, { pk: 2 }, { pk: 3 }])).toEqual([
      { pk: 1, isSelected: false, isExcluded: true },
      { pk: 2, isSelected: false, isExcluded: true },
      { pk: 3 },
    ]);
    expect(setB).toHaveBeenCalledTimes(1);
  });
});
