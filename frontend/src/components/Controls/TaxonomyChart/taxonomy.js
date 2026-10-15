export const TAXON_RANKS = [
  "kingdom",
  "phylum",
  "class",
  "order",
  "family",
  "genus",
  "species",
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
export function sunburstTrace(tree, rootLabel) {
  const trace = { ids: [], labels: [], parents: [], values: [], ranks: [] };
  const ROOT_ID = "\u0000root";
  function walk(node, parentId) {
    if (node.rank === "kingdom") {
      node.children.forEach((child) => walk(child, parentId));
      return;
    }
    const id = node.rank === "root" ? ROOT_ID : node.id;
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
