import { cdmDataTypeLabel } from "./dataLayers.js";

// Offered only while the list is grouped, and its default then.
export const GROUP_SIZE = "groupSize";
export const DEFAULT_SORT = { field: "title", dir: "asc" };
export const DAYS_SORT = { field: "days", dir: "desc" };
export const GROUP_SIZE_SORT = { field: GROUP_SIZE, dir: "desc" };

const NUMERIC_FIELDS = new Set([
  GROUP_SIZE,
  "locations",
  "days",
  "size",
  "downloadable",
]);

// Stable empty set, so an unpinned list doesn't create a new Set every render
// and thrash memo deps.
const EMPTY_SET = new Set();

// The "what's here" card's datasets, which the list sorts to its top.
export const pinnedPksOf = (featureQuery) =>
  featureQuery?.datasetPks?.length
    ? new Set(featureQuery.datasetPks.map(Number))
    : EMPTY_SET;

const sortValue = (row, field, t) => {
  const isGrid = row.cdm_data_type === "Grid";
  switch (field) {
    case "title":
      return (row.title || "").toLowerCase();
    case "type":
      return (
        isGrid
          ? t("griddapTypeLabel")
          : cdmDataTypeLabel(row.cdm_data_type, t) || ""
      ).toLowerCase();
    case "platform":
      return (
        isGrid ? t("griddapTypeLabel") : row.platform || ""
      ).toLowerCase();
    case "locations":
      return isGrid ? -1 : Number(row.profiles_count) || 0;
    case "days":
      return Number(row.days) || 0;
    case "size":
      return Number(row?.sizeEstimate?.filteredSize) || 0;
    case "downloadable":
      return row.internalDownload ? 1 : 0;
    default:
      return 0;
  }
};

// The datasets list's row order, which the "what's here" card follows too.
// Grids come first, folded by the list into one row so regional satellite
// products don't bury the measurements taken in a place; within grids and the
// rest, map-click datasets lead, and each block keeps the chosen sort. Group
// size orders groups, not rows.
export function sortDatasets(
  rows,
  sort,
  { pinnedPks = EMPTY_SET, t, language },
) {
  const { field, dir } = sort.field === GROUP_SIZE ? DEFAULT_SORT : sort;
  const factor = dir === "asc" ? 1 : -1;
  return [...(rows || [])].sort((a, b) => {
    const ga = a.cdm_data_type === "Grid" ? 0 : 1;
    const gb = b.cdm_data_type === "Grid" ? 0 : 1;
    if (ga !== gb) return ga - gb;
    const pa = pinnedPks.has(Number(a.pk)) ? 0 : 1;
    const pb = pinnedPks.has(Number(b.pk)) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const va = sortValue(a, field, t);
    const vb = sortValue(b, field, t);
    if (NUMERIC_FIELDS.has(field)) return (va - vb) * factor;
    return String(va).localeCompare(String(vb), language) * factor;
  });
}
