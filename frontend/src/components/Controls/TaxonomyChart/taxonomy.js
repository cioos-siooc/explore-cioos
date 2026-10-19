export const TAXON_RANKS = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
];

// ColorBrewer "Paired", as obis.org's own sunburst uses.
export const OBIS_COLORWAY = [
  "#a6cee3",
  "#1f78b4",
  "#b2df8a",
  "#33a02c",
  "#fb9a99",
  "#e31a1c",
  "#fdbf6f",
  "#ff7f00",
  "#cab2d6",
  "#6a3d9a",
  "#ffff99",
  "#b15928",
];

const CHECKLIST_PAGE_SIZE = 5000;

// OBIS caps a checklist page well under the taxa count of its larger datasets,
// so page through until every taxon is in.
export async function fetchChecklist(datasetId, signal) {
  const taxa = [];
  for (;;) {
    const params = new URLSearchParams({
      datasetid: datasetId,
      size: CHECKLIST_PAGE_SIZE,
      skip: taxa.length,
    });
    const response = await fetch(
      `https://api.obis.org/v3/checklist?${params}`,
      { signal },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { total, results } = await response.json();
    taxa.push(...results);
    if (!results.length || taxa.length >= total) return taxa;
  }
}

// A checklist row's `records` counts only the occurrences identified to exactly
// that taxon, so a node's total is its own plus everything beneath it. A row
// whose classification has a gap stops at the last rank before it.
export function buildTaxonomyTree(taxa) {
  const root = { id: "", name: "", rank: "root", self: 0, children: new Map() };
  for (const taxon of taxa) {
    let node = root;
    for (const rank of TAXON_RANKS) {
      const name = taxon[rank];
      if (!name) break;
      let child = node.children.get(name);
      if (!child) {
        child = {
          id: node.id ? `${node.id}/${name}` : name,
          name,
          rank,
          self: 0,
          children: new Map(),
        };
        node.children.set(name, child);
      }
      node = child;
    }
    node.self += taxon.records ?? 0;
  }
  return finalize(root);
}

function finalize(node) {
  const children = [...node.children.values()]
    .map(finalize)
    .sort((a, b) => b.total - a.total);
  return {
    id: node.id,
    name: node.name,
    rank: node.rank,
    total: node.self + children.reduce((sum, child) => sum + child.total, 0),
    children,
  };
}

// Phyla make the first ring, as in OBIS's own sunburst: Plotly colours by
// that ring, and a dataset is nearly always one kingdom, which would paint
// the whole chart a single colour.
export const SUNBURST_ROOT_ID = "\u0000root";

export function sunburstTrace(tree, rootLabel) {
  const trace = { ids: [], labels: [], parents: [], values: [], ranks: [] };
  function walk(node, parentId) {
    if (node.rank === "kingdom") {
      node.children.forEach((child) => walk(child, parentId));
      return;
    }
    const id = node.rank === "root" ? SUNBURST_ROOT_ID : node.id;
    trace.ids.push(id);
    trace.labels.push(node.rank === "root" ? rootLabel : node.name);
    trace.parents.push(parentId);
    trace.values.push(node.total);
    trace.ranks.push(node.rank);
    node.children.forEach((child) => walk(child, id));
  }
  walk(tree, "");
  return trace;
}

// The colour Plotly gives each phylum's sector, keyed by node id: it sorts the
// first ring by value, across kingdoms since sunburstTrace skips them, then
// deals out the colorway in that order (extendsunburstcolors off, so it wraps).
export function phylumColors(tree) {
  const phyla = tree.children
    .flatMap((kingdom) => kingdom.children)
    .sort((a, b) => b.total - a.total);
  return new Map(
    phyla.map((phylum, i) => [
      phylum.id,
      OBIS_COLORWAY[i % OBIS_COLORWAY.length],
    ]),
  );
}

function relativeLuminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// White text where it out-contrasts the dark ink, i.e. on the darker colours.
export function inkOn(hex) {
  const l = relativeLuminance(hex);
  const ink = relativeLuminance("#152f37");
  return 1.05 / (l + 0.05) > (l + 0.05) / (ink + 0.05) ? "light" : "dark";
}
