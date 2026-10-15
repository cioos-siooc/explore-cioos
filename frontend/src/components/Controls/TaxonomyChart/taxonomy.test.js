import { describe, it, expect, vi, afterEach } from "vitest";

import {
  buildTaxonomyTree,
  fetchChecklist,
  sunburstTrace,
} from "./taxonomy.js";

const FISH = {
  kingdom: "Animalia",
  phylum: "Chordata",
  class: "Teleostei",
  order: "Perciformes",
  family: "Nototheniidae",
  genus: "Pleuragramma",
};

const TAXA = [
  { ...FISH, species: "Pleuragramma antarcticum", records: 10 },
  // Identified to genus only: its records sit on the genus itself.
  { ...FISH, records: 3 },
  { kingdom: "Animalia", phylum: "Mollusca", records: 20 },
  // A gap in the classification stops the path at the rank before it.
  {
    kingdom: "Animalia",
    phylum: "Annelida",
    order: "Phyllodocida",
    records: 1,
  },
];

describe("buildTaxonomyTree", () => {
  it("rolls each taxon's own records up into every rank above it", () => {
    const tree = buildTaxonomyTree(TAXA);
    expect(tree.total).toBe(34);
    const [animalia] = tree.children;
    expect(animalia).toMatchObject({ name: "Animalia", total: 34 });
    let genus = animalia.children.find((c) => c.name === "Chordata");
    while (genus.rank !== "genus") [genus] = genus.children;
    expect(genus.total).toBe(13);
    expect(genus.children).toEqual([
      expect.objectContaining({ name: "Pleuragramma antarcticum", total: 10 }),
    ]);
  });

  it("orders siblings by descending total", () => {
    const [animalia] = buildTaxonomyTree(TAXA).children;
    expect(animalia.children.map((c) => c.name)).toEqual([
      "Mollusca",
      "Chordata",
      "Annelida",
    ]);
  });

  it("stops a path at a gap in the classification", () => {
    const [animalia] = buildTaxonomyTree(TAXA).children;
    const annelida = animalia.children.find((c) => c.name === "Annelida");
    expect(annelida).toMatchObject({ total: 1, children: [] });
  });
});

describe("sunburstTrace", () => {
  it("rings the phyla straight under the root, skipping the kingdom", () => {
    const trace = sunburstTrace(buildTaxonomyTree(TAXA), "All");
    expect(trace.labels[0]).toBe("All");
    expect(trace.parents[0]).toBe("");
    expect(trace.values[0]).toBe(34);
    expect(trace.labels).not.toContain("Animalia");
    const mollusca = trace.labels.indexOf("Mollusca");
    expect(trace.parents[mollusca]).toBe(trace.ids[0]);
    expect(new Set(trace.ids).size).toBe(trace.ids.length);
  });
});

describe("fetchChecklist", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pages through the checklist until every taxon is in", async () => {
    const pages = [
      { total: 3, results: [{ records: 1 }, { records: 2 }] },
      { total: 3, results: [{ records: 3 }] },
    ];
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(pages.shift())),
    );
    vi.stubGlobal("fetch", fetchMock);

    const taxa = await fetchChecklist("abc");

    expect(taxa).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = new URL(fetchMock.mock.calls[1][0]);
    expect(second.searchParams.get("datasetid")).toBe("abc");
    expect(second.searchParams.get("skip")).toBe("2");
  });

  it("rejects on an HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    await expect(fetchChecklist("abc")).rejects.toThrow("HTTP 500");
  });
});
