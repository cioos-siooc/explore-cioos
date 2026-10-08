// Grouping of the datasets list (DatasetsTable) by one dimension at a time.
//
// A group is identified by a stable key, never by its label: the keys are
// persisted (URL: ?groupBy=&hiddenGroups=) and matched against the hidden set,
// both of which have to survive a language switch. Labels are derived from the
// key at render time.

import erddapServers from "../erddapServers.json";
import { formatErddapServerName } from "../utilities.jsx";
import { cdmDataTypeLabel } from "./dataLayers.js";

export const GROUP_NONE = "none";

// Keys with no natural value behind them. Prefixed so they can't collide with
// a real organization / EOV / platform name.
export const GRID_KEY = "__grid__";
export const OTHER_KEY = "__other__";
export const UNCATEGORIZED_KEY = "__uncategorized__";
export const IN_VIEW_KEY = "in";
export const OUT_OF_VIEW_KEY = "out";
export const SELECTED_KEY = "selected";
export const UNSELECTED_KEY = "unselected";

// The data portal dimension is two levels deep: each ERDDAP server and OBIS
// node is a group of its own, nested under its kind. The parents keep the keys
// the flat ERDDAP/OBIS grouping used, so hidden groups in old links still hold.
export const ERDDAP_KEY = "erddap";
export const OBIS_KEY = "obis";
const PARENT_KEYS_BY_DIMENSION = { source: [ERDDAP_KEY, OBIS_KEY] };

// Groups that sort last regardless of their label.
const LAST_KEYS = new Set([OTHER_KEY, UNCATEGORIZED_KEY]);

// 'inView' groups by the current map viewport rather than by a property of the
// dataset, so its membership changes on every pan — hiding it from the map is
// not offered (see DatasetsTable), which would otherwise reload the tiles on
// each pan for no visible gain. 'selected' is the same shape of thing: it
// groups by what the user has put aside, which they change constantly, so it
// isn't hideable either.
export const HIDEABLE_DIMENSIONS = new Set([
  "type",
  "platform",
  "organization",
  "eov",
  "source",
]);

export function groupOptions(t) {
  return [
    { id: GROUP_NONE, label: t("datasetsCardGroupNoneText") },
    { id: "type", label: t("datasetsTableHeaderTypeText") },
    { id: "platform", label: t("datasetsCardSortPlatformText") },
    { id: "organization", label: t("datasetsCardGroupOrganizationText") },
    { id: "eov", label: t("datasetsCardGroupEovText") },
    { id: "source", label: t("datasetsCardGroupSourceText") },
    { id: "inView", label: t("datasetsCardOnlyInViewText") },
    { id: "selected", label: t("datasetsCardGroupSelectedText") },
  ];
}

export function isGroupDimension(groupBy) {
  return Boolean(groupBy) && groupBy !== GROUP_NONE;
}

// The group key(s) a dataset belongs to under the active dimension. The
// array-valued dimensions (organization, eov) return several, so a dataset
// shows under each of its values. `selectedPks` is only read for the
// 'selected' dimension — membership there is the shortlist, not a row field.
export function groupKeysFor(row, groupBy, datasetsInViewPks, selectedPks) {
  const isGrid = row.cdm_data_type === "Grid";
  switch (groupBy) {
    case "type":
      return [isGrid ? GRID_KEY : row.cdm_data_type || OTHER_KEY];
    case "platform":
      return [isGrid ? GRID_KEY : row.platform || OTHER_KEY];
    case "source":
      if (row.source_type !== "obis") {
        return [`${ERDDAP_KEY}:${row.erddap_server_url || OTHER_KEY}`];
      }
      return row.obis_nodes?.length
        ? row.obis_nodes.map((node) => `${OBIS_KEY}:${node}`)
        : [`${OBIS_KEY}:${UNCATEGORIZED_KEY}`];
    case "organization":
      return row.organizations?.length
        ? row.organizations
        : [UNCATEGORIZED_KEY];
    case "eov":
      return row.eovs?.length ? row.eovs : [UNCATEGORIZED_KEY];
    case "inView":
      return [datasetsInViewPks?.has(row.pk) ? IN_VIEW_KEY : OUT_OF_VIEW_KEY];
    case "selected":
      return [selectedPks?.has(row.pk) ? SELECTED_KEY : UNSELECTED_KEY];
    default:
      return [];
  }
}

// The parent groups a nested dimension opens with; empty for a flat one.
export function parentGroupKeys(groupBy) {
  return PARENT_KEYS_BY_DIMENSION[groupBy] ?? [];
}

// The group a nested group sits in, or null at the top level.
export function groupParent(key, groupBy) {
  if (!PARENT_KEYS_BY_DIMENSION[groupBy]) return null;
  const separator = String(key).indexOf(":");
  return separator === -1 ? null : key.slice(0, separator);
}

// Hiding a parent hides every group nested in it.
export function isGroupHidden(key, groupBy, hiddenGroups) {
  return hiddenGroups.has(key) || hiddenGroups.has(groupParent(key, groupBy));
}

export function groupLabel(key, groupBy, t, language = "en") {
  const parent = groupParent(key, groupBy);
  if (parent) {
    const child = key.slice(parent.length + 1);
    if (parent === ERDDAP_KEY && child !== OTHER_KEY) {
      return formatErddapServerName(child, language, erddapServers);
    }
    return parent === OBIS_KEY && child !== UNCATEGORIZED_KEY
      ? child
      : groupLabel(child, groupBy, t, language);
  }
  if (key === GRID_KEY) return t("griddapTypeLabel");
  if (key === OTHER_KEY) return t("datasetsCardGroupOtherText");
  if (key === UNCATEGORIZED_KEY) return t("datasetsCardGroupUncategorizedText");
  switch (groupBy) {
    case "type":
      return cdmDataTypeLabel(key, t);
    case "source":
      return key === OBIS_KEY ? "OBIS" : "ERDDAP";
    case "inView":
      return key === IN_VIEW_KEY
        ? t("datasetsCardOnlyInViewText")
        : t("datasetsCardGroupOutOfViewText");
    case "selected":
      return key === SELECTED_KEY
        ? t("datasetsCardGroupInSelectionText")
        : t("datasetsCardGroupNotInSelectionText");
    default:
      return key;
  }
}

// The two-group dimensions have a natural order that alphabetising would
// scramble — and would scramble differently per language. The group the user
// asked about goes first.
const FIRST_KEY_BY_DIMENSION = {
  inView: IN_VIEW_KEY,
  selected: SELECTED_KEY,
};

// Alphabetical by label, with Other/Uncategorized pinned to the bottom.
export function sortGroupKeys(keys, groupBy, t, language) {
  const firstKey = FIRST_KEY_BY_DIMENSION[groupBy];
  return [...keys].sort((a, b) => {
    if (firstKey) {
      if (a === firstKey) return -1;
      if (b === firstKey) return 1;
    }
    const aLast = LAST_KEYS.has(a);
    const bLast = LAST_KEYS.has(b);
    if (aLast !== bLast) return aLast ? 1 : -1;
    return groupLabel(a, groupBy, t, language).localeCompare(
      groupLabel(b, groupBy, t, language),
      language,
    );
  });
}

// The datasets the map must not draw: those whose every group is hidden. A
// dataset in several groups (an organization pair, say) stays on the map as
// long as one of them is still shown.
export function hiddenDatasetPksFor(
  datasets,
  groupBy,
  hiddenGroups,
  datasetsInViewPks,
  selectedPks,
) {
  const hidden = new Set();
  if (!isGroupDimension(groupBy) || hiddenGroups.size === 0) return hidden;
  for (const row of datasets) {
    const keys = groupKeysFor(row, groupBy, datasetsInViewPks, selectedPks);
    if (
      keys.length > 0 &&
      keys.every((key) => isGroupHidden(key, groupBy, hiddenGroups))
    ) {
      hidden.add(row.pk);
    }
  }
  return hidden;
}
