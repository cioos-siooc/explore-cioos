import { useTranslation } from "react-i18next";

import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../components/config.js";
import eovsJSONfile from "../eovs.json";
import eovCategoriesJSONfile from "../eovCategories.json";
import {
  generateRangeSelectBadgeTitle,
  polygonIsRectangle,
  setAllOptionsIsSelectedTo,
} from "../utilities.jsx";
import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
} from "./dataLayers.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import useEovCategories from "./useEovCategories.js";
import useSourceKinds from "./useSourceKinds.js";

const stateOf = (option) =>
  option.isSelected ? "include" : option.isExcluded ? "exclude" : undefined;

// Every filter, as groups of `{ id, label, description?, state, toggle }`
// options: the one description the chips, the Filters badge, the search
// palette and reset all read, so none of them can disagree about what is set.
// An option is applied when it has a `state`; `toggle(target)` follows the
// geometry switches' rule (see toggledDataLayerChoice): asking for the state
// an option is already in clears it. Each writes the same provider state the
// classic filter UI does, so both stay in step and the URL carries either.
//
// A group carries `panelName`, the Filters modal row it is set from, and
// `clear`, which drops all of it. An option may also carry `closes` (the
// palette closes once it is picked, as a draw happens on the map behind it),
// `action` (the verb to show instead of Add / Remove), `includeOnly` (it
// cannot be excluded) and `shortcut` (it sets other options of its group at
// once, as an EOV category does; `covers` names their ids, and while the whole
// of them is set the shortcut is listed as applied in their place — see
// appliedOptions).
//
// scientificNameMatches are WoRMS hits for the palette's term, which only the
// API can produce; the picked names are always offered so they can be removed.
// typedRange is a time or depth range read off that term (see
// parseRangeQuery): its group is `pinned`, offered as typed rather than
// matched against it.
export default function useFilterModel(scientificNameMatches = [], typedRange) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const filters = useFilters();
  const eovCategories = useEovCategories();
  const sourceKinds = useSourceKinds();
  const { dataLayerChoices, toggleDataLayer, resetDataLayers, requestDraw } =
    useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();

  // "(all)" once a dataset has to carry every included value, not just one.
  const matchAllLabel = (label, matchAll, includedCount) =>
    matchAll && includedCount > 1 ? `${label} (${t("filterMatchAll")})` : label;

  const listOptions = (list, setList, translatable, idPrefix = "") =>
    list.map((option) => {
      const state = stateOf(option);
      return {
        id: `${idPrefix}${option.pk}`,
        label: filters.optionLabel(option, translatable),
        description: option[`hover_${lang}`] ?? option.url,
        state,
        toggle: (target) => {
          const next = state === target ? undefined : target;
          setList((prev) =>
            prev.map((o) =>
              o.pk === option.pk
                ? {
                    ...o,
                    isSelected: next === "include",
                    isExcluded: next === "exclude",
                  }
                : o,
            ),
          );
        },
      };
    });

  const listGroup = (
    key,
    label,
    panelName,
    list,
    setList,
    translatable,
    matchAll = false,
  ) => ({
    key,
    label: matchAllLabel(
      label,
      matchAll,
      list.filter((o) => o.isSelected).length,
    ),
    panelName,
    options: listOptions(list, setList, translatable),
    clear: () => setAllOptionsIsSelectedTo(false, list, setList),
  });

  const toggleGroup = (
    key,
    label,
    panelName,
    optionLabel,
    description,
    on,
    set,
  ) => ({
    key,
    label,
    panelName,
    options: [
      {
        id: key,
        label: optionLabel,
        description,
        state: on ? "include" : undefined,
        includeOnly: true,
        toggle: () => set(!on),
      },
    ],
    clear: () => set(false),
  });

  const {
    scientificNamesSelected: picked,
    scientificNamesExcluded: dropped,
    setScientificNamesSelected,
    setScientificNamesExcluded,
  } = filters;
  const scientificNameOption = (name, { vernacular, rank } = {}) => {
    const state = picked.includes(name)
      ? "include"
      : dropped.includes(name)
        ? "exclude"
        : undefined;
    return {
      id: name,
      label: name,
      hint: vernacular,
      description: rank,
      matchText: `${name} ${vernacular ?? ""}`,
      state,
      toggle: (target) => {
        const next = state === target ? undefined : target;
        const others = (prev) => prev.filter((n) => n !== name);
        setScientificNamesSelected((prev) =>
          next === "include" ? [...others(prev), name] : others(prev),
        );
        setScientificNamesExcluded((prev) =>
          next === "exclude" ? [...others(prev), name] : others(prev),
        );
      },
    };
  };
  const scientificNames = [...picked, ...dropped];

  const boxDrawn = Boolean(polygon) && polygonIsRectangle(polygon);
  const areaOption = (mode, label, drawn) => ({
    id: mode,
    label,
    description: t("quickFilterAreaTitle"),
    matchText: `${label} ${t("spatialFilterFilterName")}`,
    state: drawn ? "include" : undefined,
    includeOnly: true,
    closes: !drawn,
    action: drawn ? undefined : t("filterSearchActionDraw"),
    toggle: () => requestDraw(drawn ? "clear" : mode),
  });

  const rangeGroup = (key, label, current, defaults, set, unit) => {
    const typed = typedRange?.key === key;
    const [start, end] = typed ? [typedRange.start, typedRange.end] : current;
    const active = current[0] !== defaults[0] || current[1] !== defaults[1];
    const applied = active && start === current[0] && end === current[1];
    return {
      key,
      label,
      panelName: label,
      pinned: typed,
      options:
        typed || active
          ? [
              {
                id: key,
                label: generateRangeSelectBadgeTitle(
                  label,
                  [start, end],
                  defaults,
                  unit,
                ),
                state: applied ? "include" : undefined,
                includeOnly: true,
                toggle: () => (applied ? set(...defaults) : set(start, end)),
              },
            ]
          : [],
      clear: () => set(...defaults),
    };
  };

  return [
    {
      key: "text",
      label: t("textSearchFilterName"),
      options: datasetTitleSearchText
        ? [
            {
              id: "text",
              label: `“${datasetTitleSearchText}”`,
              state: "include",
              includeOnly: true,
              toggle: () => setDatasetTitleSearchText(""),
            },
          ]
        : [],
      clear: () => setDatasetTitleSearchText(""),
    },
    toggleGroup(
      "realtime",
      t("realtimeFilterName"),
      t("realtimeFilterName"),
      t("realtimeFilterOptionText"),
      t("quickFilterRealtimeTitle"),
      filters.realtimeOnly,
      filters.setRealtimeOnly,
    ),
    toggleGroup(
      "inView",
      t("datasetsCardOnlyInViewText"),
      t("datasetsCardOnlyInViewText"),
      t("inViewFilterOptionText"),
      t("quickFilterInViewTitle"),
      onlyInView,
      setOnlyInView,
    ),
    rangeGroup(
      "time",
      t("timeframeFilterName"),
      [filters.startDate, filters.endDate],
      [defaultStartDate, defaultEndDate],
      (start, end) => {
        filters.setStartDate(start);
        filters.setEndDate(end);
      },
    ),
    rangeGroup(
      "depth",
      t("depthRangeFilterName"),
      [filters.startDepth, filters.endDepth],
      [defaultStartDepth, defaultEndDepth],
      (start, end) => {
        filters.setStartDepth(start);
        filters.setEndDepth(end);
      },
      "(m)",
    ),
    (() => {
      // Shown by the same name the Filters list gives it, but matched on its
      // eovs.json names and category too, so it is found by either in either
      // language. Each category is offered as well, to set all of it at once.
      const group = listGroup(
        "eovs",
        t("oceanVariablesFiltername"),
        "oceanVariablesFiltername",
        filters.eovsSelected,
        filters.setEovsSelected,
        true,
        filters.eovsMatchAll,
      );
      return {
        ...group,
        options: [
          ...eovCategories.map((c) => ({
            id: `category-${c.category}`,
            label: c.label,
            description: t("filterSearchCategoryDescription", {
              count: c.count,
            }),
            matchText: `${c.names.en} ${c.names.fr}`,
            state: c.state,
            shortcut: true,
            covers: c.members.map((o) => `${o.pk}`),
            toggle: c.toggle,
          })),
          ...group.options.map((option, i) => {
            const eov = eovsJSONfile.find(
              (e) => e.value === filters.eovsSelected[i].title,
            );
            return eov
              ? {
                  ...option,
                  matchText: `${eov["label EN"]} ${eov["label FR"]} ${eovCategoriesJSONfile[eov.category].en} ${eovCategoriesJSONfile[eov.category].fr}`,
                }
              : option;
          }),
        ],
      };
    })(),
    listGroup(
      "platforms",
      t("platformsFilterName"),
      "platformsFilterName",
      filters.platformsSelected,
      filters.setPlatformsSelected,
      true,
    ),
    listGroup(
      "orgs",
      t("organizationFilterName"),
      "organizationFilterName",
      filters.orgsSelected,
      filters.setOrgsSelected,
      false,
      filters.orgsMatchAll,
    ),
    {
      key: "sources",
      label: t("sourceFilterName"),
      panelName: "sourceFilterName",
      // pk values collide between the two lists, hence the prefixed ids.
      options: [
        ...sourceKinds.map((kind) => ({
          id: `source-${kind.key}`,
          label: kind.label,
          description: t("filterSearchSourceKindDescription", {
            count: kind.members.length,
          }),
          state: kind.state,
          shortcut: true,
          covers: kind.members.map((o) => `${kind.key}-${o.pk}`),
          toggle: kind.toggle,
        })),
        ...listOptions(
          filters.erddapServersSelected,
          filters.setErddapServersSelected,
          false,
          "erddap-",
        ),
        ...listOptions(
          filters.obisNodesSelected,
          filters.setObisNodesSelected,
          false,
          "obis-",
        ),
      ],
      clear: () => {
        setAllOptionsIsSelectedTo(
          false,
          filters.erddapServersSelected,
          filters.setErddapServersSelected,
        );
        setAllOptionsIsSelectedTo(
          false,
          filters.obisNodesSelected,
          filters.setObisNodesSelected,
        );
      },
    },
    {
      key: "dataLayers",
      label: t("layerSelectorLabel"),
      panelName: "layerSelectorLabel",
      options: DATA_LAYER_KEYS.map((key) => ({
        id: key,
        label: t(DATA_LAYER_LABEL_KEYS[key]),
        description: t(DATA_LAYER_HINT_KEYS[key]),
        state: dataLayerChoices[key],
        toggle: (target) => toggleDataLayer(key, target),
      })),
      clear: resetDataLayers,
    },
    filters.obisDataAvailable && {
      key: "scientificName",
      label: matchAllLabel(
        t("scientificNameFilterName"),
        filters.scientificNamesMatchAll,
        picked.length,
      ),
      panelName: "scientificNameFilterName",
      options: [
        ...scientificNames.map((name) => scientificNameOption(name)),
        ...scientificNameMatches
          .filter((m) => !scientificNames.includes(m.scientificName))
          .map((m) => scientificNameOption(m.scientificName, m)),
      ],
      clear: () => {
        setScientificNamesSelected([]);
        setScientificNamesExcluded([]);
      },
    },
    listGroup(
      "datasets",
      t("datasetsFilterName"),
      "datasetsFilterName",
      filters.datasetsSelected,
      filters.setDatasetsSelected,
      true,
    ),
    // After the catalogue's values, which a few loosely matched letters
    // ("oxyg" for "Polygon") should not push down.
    {
      key: "area",
      label: t("spatialFilterFilterName"),
      panelName: "spatialFilterFilterName",
      options: [
        areaOption("box", t("drawBoundingBoxOption"), boxDrawn),
        areaOption(
          "polygon",
          t("drawPolygonOption"),
          Boolean(polygon) && !boxDrawn,
        ),
      ],
      clear: () => requestDraw("clear"),
    },
  ].filter(Boolean);
}
