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

  it("groups a portal with several sources by source, keeping its leaves flat", () => {
    const [pacific] = buildPortals({
      erddapServersSelected: [
        server(0, "https://hakai"),
        server(1, "https://cp"),
      ],
      portalOwners: [
        {
          pk: "CIOOS Pacific",
          title: "CIOOS Pacific",
          erddapServers: ["https://hakai", "https://cp"],
          sources: [
            {
              pk: "Hakai Institute",
              title: "Hakai Institute",
              erddapServers: ["https://hakai"],
            },
            {
              pk: "CIOOS Pacific",
              title: "CIOOS Pacific",
              erddapServers: ["https://cp"],
            },
          ],
        },
      ],
      obisCataloguesSelected: [
        { pk: "Hakai Institute", title: "Hakai Institute", isSelected: true },
        { pk: "CIOOS Pacific", title: "CIOOS Pacific" },
      ],
    });
    expect(
      pacific.institutes.map((i) => [
        i.label,
        i.leaves.map((l) => l.id),
        i.someSet,
      ]),
    ).toEqual([
      ["CIOOS Pacific", ["erddap-1", "obiscat-CIOOS Pacific"], false],
      ["Hakai Institute", ["erddap-0", "obiscat-Hakai Institute"], true],
    ]);
    expect(pacific.leaves.map((l) => [l.id, l.group])).toEqual([
      ["erddap-1", "CIOOS Pacific"],
      ["obiscat-CIOOS Pacific", "CIOOS Pacific"],
      ["erddap-0", "Hakai Institute"],
      ["obiscat-Hakai Institute", "Hakai Institute"],
    ]);
  });

  it("does not group a portal with a single source", () => {
    const [slgo] = buildPortals({
      erddapServersSelected: [server(0, "https://a")],
      portalOwners: [
        {
          pk: "SLGO",
          title: "SLGO",
          erddapServers: ["https://a"],
          sources: [
            { pk: "SLGO", title: "SLGO", erddapServers: ["https://a"] },
          ],
        },
      ],
    });
    expect(slgo.institutes).toBeUndefined();
    expect(slgo.leaves.map((l) => [l.id, l.group])).toEqual([
      ["erddap-0", undefined],
    ]);
  });

  it("names a known portal in French", () => {
    const owner = (title) => ({
      portalOwners: [{ pk: title, title, erddapServers: ["https://a"] }],
      erddapServersSelected: [server(0, "https://a")],
    });
    const name = "St. Lawrence Global Observatory (SLGO)";
    expect(buildPortals(owner(name), "fr")[0].label).toBe(
      "Observatoire global du Saint-Laurent (OGSL)",
    );
    expect(buildPortals(owner(name), "en")[0].label).toBe(name);
    expect(buildPortals(owner("DataStream"), "fr")[0].label).toBe("DataStream");
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
