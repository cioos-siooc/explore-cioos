import { toggleOptionExcluded, toggleOptionIncluded } from "../utilities.jsx";
import {
  DATA_LAYER_KEYS,
  PROFILE_TYPE_KEYS,
  TRAJECTORY_TYPE_KEYS,
  dataLayerKeyForDataset,
} from "./dataLayers.js";
import {
  ERDDAP_KEY,
  GRID_KEY,
  OBIS_KEY,
  groupParent,
} from "./datasetGroups.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import useEovCategories from "./useEovCategories.js";
import useSourceKinds from "./useSourceKinds.js";

// The type group a geometry switch stands for. OBIS has none: its datasets
// group under their cdm_data_type, 'Point', beside ERDDAP's.
const TYPE_KEY_BY_LAYER = new Map([
  ...PROFILE_TYPE_KEYS,
  ...TRAJECTORY_TYPE_KEYS,
  ["grid", GRID_KEY],
]);

const stateOf = (option) =>
  option.isSelected ? "include" : option.isExcluded ? "exclude" : undefined;

const listOption = (list, setList, matches) => {
  const option = list.find(matches);
  if (!option) return undefined;
  return {
    state: stateOf(option),
    toggle: (target) =>
      setList((prev) =>
        prev.map((o) =>
          matches(o)
            ? (target === "include"
                ? toggleOptionIncluded
                : toggleOptionExcluded)(o)
            : o,
        ),
      ),
  };
};

// The datasets-list groups as the main-filter options they stand for.
// `filterFor(key)` is `{ state: "include" | "exclude" | undefined,
// toggle(target) }`, where asking for the state it is already in clears it, as
// in the Filters modal; undefined for a group no filter can express (Other,
// Uncategorized, a type no geometry switch names). `filteredKeys` are the
// groups the dimension's filter names, and `narrowed` says whether that filter
// is set at all — a geometry switch can be with no group to show for it.
export default function useGroupFilter(groupBy) {
  const filters = useFilters();
  const { dataLayerChoices, toggleDataLayer } = useMapState();
  const eovCategories = useEovCategories();
  const sourceKinds = useSourceKinds();

  const filterFor = (key) => {
    switch (groupBy) {
      case "type": {
        const layer =
          key === GRID_KEY
            ? "grid"
            : dataLayerKeyForDataset({ cdm_data_type: key });
        return (
          layer && {
            state: dataLayerChoices[layer],
            toggle: (target) => toggleDataLayer(layer, target),
          }
        );
      }
      case "platform":
        return listOption(
          filters.platformsSelected,
          filters.setPlatformsSelected,
          (o) => o.title === key,
        );
      case "organization":
        return listOption(
          filters.orgsSelected,
          filters.setOrgsSelected,
          (o) => o.title === key,
        );
      case "eov": {
        const parent = groupParent(key, groupBy);
        if (!parent) return eovCategories.find((c) => c.category === key);
        const value = key.slice(parent.length + 1);
        return listOption(
          filters.eovsSelected,
          filters.setEovsSelected,
          (o) => o.title === value,
        );
      }
      case "source": {
        const parent = groupParent(key, groupBy);
        if (!parent) return sourceKinds.find((kind) => kind.key === key);
        const value = key.slice(parent.length + 1);
        return parent === ERDDAP_KEY
          ? listOption(
              filters.erddapServersSelected,
              filters.setErddapServersSelected,
              (o) => o.url === value,
            )
          : listOption(
              filters.obisNodesSelected,
              filters.setObisNodesSelected,
              (o) => o.title === value,
            );
      }
      default:
        return undefined;
    }
  };

  const stated = (list, toKey) =>
    list.filter((o) => o.isSelected || o.isExcluded).map(toKey);
  const title = (o) => o.title;
  let filteredKeys;
  let narrowed;
  switch (groupBy) {
    case "type": {
      const layers = DATA_LAYER_KEYS.filter((key) => dataLayerChoices[key]);
      filteredKeys = layers
        .map((layer) => TYPE_KEY_BY_LAYER.get(layer))
        .filter(Boolean);
      narrowed = layers.length > 0;
      break;
    }
    case "platform":
      filteredKeys = stated(filters.platformsSelected, title);
      break;
    case "organization":
      filteredKeys = stated(filters.orgsSelected, title);
      break;
    case "eov":
      filteredKeys = stated(
        filters.eovsSelected,
        (o) => `${o.category}:${o.title}`,
      );
      break;
    case "source": {
      // A list set as a whole is the ERDDAP or OBIS row's doing: naming every
      // server or node in it would list the whole catalogue.
      const sourceKeys = (list, toKey) =>
        list.every((o) => o.isSelected) || list.every((o) => o.isExcluded)
          ? []
          : stated(list, toKey);
      narrowed = [
        filters.erddapServersSelected,
        filters.obisNodesSelected,
      ].some((list) => list.some((o) => o.isSelected || o.isExcluded));
      filteredKeys = [
        ...sourceKeys(
          filters.erddapServersSelected,
          (o) => `${ERDDAP_KEY}:${o.url}`,
        ),
        ...sourceKeys(
          filters.obisNodesSelected,
          (o) => `${OBIS_KEY}:${o.title}`,
        ),
      ];
      break;
    }
    default:
      filteredKeys = [];
  }

  return {
    filterFor,
    filteredKeys,
    narrowed: narrowed ?? filteredKeys.length > 0,
  };
}
