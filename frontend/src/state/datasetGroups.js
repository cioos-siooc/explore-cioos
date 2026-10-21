// Groups are identified by a stable key, never by label, so they survive a
// language switch.

import eovCategories from "../eovCategories.json";
import eovs from "../eovs.json";
import erddapServers from "../erddapServers.json";
import platforms from "../platforms.json";
import { platformCategory, platformLabel } from "../platformVocab.js";
import { formatErddapServerName } from "../utilities.jsx";
import { cdmDataTypeLabel } from "./dataLayers.js";

export const GROUP_NONE = "none";

// Prefixed so they can't collide with a real organization / EOV / platform name.
export const GRID_KEY = "__grid__";
export const OTHER_KEY = "__other__";
export const UNCATEGORIZED_KEY = "__uncategorized__";

// A nested group's key is `parent:value`.
export const ERDDAP_KEY = "erddap";
export const OBIS_KEY = "obis";
const PARENT_KEYS_BY_DIMENSION = {
  source: [ERDDAP_KEY, OBIS_KEY],
  eov: Object.keys(eovCategories),
  platform: [...new Set(platforms.map((p) => p.category))],
};

export function eovCategory(eov) {
  return eovs.find((e) => e.value === eov)?.category || "Other";
}

// Groups that sort last regardless of their label.
const LAST_KEYS = new Set([OTHER_KEY, UNCATEGORIZED_KEY]);

const DIMENSIONS = new Set([
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
  ];
}

// Also validates ?groupBy= from old links, whose in-view and selection
// groupings are gone.
export function isGroupDimension(groupBy) {
  return DIMENSIONS.has(groupBy);
}

// Array-valued dimensions return several, so a dataset shows under each.
export function groupKeysFor(row, groupBy) {
  const isGrid = row.cdm_data_type === "Grid";
  switch (groupBy) {
    case "type":
      return [isGrid ? GRID_KEY : row.cdm_data_type || OTHER_KEY];
    case "platform":
      if (isGrid) return [GRID_KEY];
      return row.platform
        ? [`${platformCategory(row.platform)}:${row.platform}`]
        : [OTHER_KEY];
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
      return row.eovs?.length
        ? row.eovs.map((eov) => `${eovCategory(eov)}:${eov}`)
        : [UNCATEGORIZED_KEY];
    default:
      return [];
  }
}

export function parentGroupKeys(groupBy) {
  return PARENT_KEYS_BY_DIMENSION[groupBy] ?? [];
}

export function groupParent(key, groupBy) {
  if (!PARENT_KEYS_BY_DIMENSION[groupBy]) return null;
  const separator = String(key).indexOf(":");
  return separator === -1 ? null : key.slice(0, separator);
}

export function groupLabel(key, groupBy, t, language = "en") {
  const parent = groupParent(key, groupBy);
  if (parent) {
    const child = key.slice(parent.length + 1);
    if (parent === ERDDAP_KEY && child !== OTHER_KEY) {
      return formatErddapServerName(child, language, erddapServers);
    }
    if (groupBy === "eov") return t(child);
    if (groupBy === "platform") return platformLabel(child, language);
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
    case "platform":
      return platformLabel(key, language);
    case "eov":
      return (
        eovCategories[key]?.[language.startsWith("fr") ? "fr" : "en"] ?? key
      );
    default:
      return key;
  }
}

// Alphabetical by label, with Other/Uncategorized pinned to the bottom.
export function sortGroupKeys(keys, groupBy, t, language) {
  return [...keys].sort((a, b) => {
    const aLast = LAST_KEYS.has(a);
    const bLast = LAST_KEYS.has(b);
    if (aLast !== bLast) return aLast ? 1 : -1;
    return groupLabel(a, groupBy, t, language).localeCompare(
      groupLabel(b, groupBy, t, language),
      language,
    );
  });
}
