import { useTranslation } from "react-i18next";

import {
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
} from "../components/config.js";
import eovsJSONfile from "../eovs.json";
import { polygonIsRectangle } from "../utilities.jsx";
import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
} from "./dataLayers.js";
import { useFilters } from "./filters/FilterProvider.jsx";
import { useMapState } from "./map/MapStateProvider.jsx";
import { useSelection } from "./selection/SelectionProvider.jsx";
import useResetAllFilters from "./useResetAllFilters.js";

const stateOf = (option) =>
  option.isSelected ? "include" : option.isExcluded ? "exclude" : undefined;

// Every value any filter can take, as groups of
// `{ id, label, description?, state, toggle }`
// options for the search bar to match against. An option may also carry
// `closes` (the palette closes once it is picked, as a draw happens on the map
// behind it), `action` (the verb to show instead of Add / Remove) and
// `command` (an action rather than a value, so it has no state to show). `toggle(target)` follows the
// geometry switches' rule (see toggledDataLayerChoice): asking for the state
// an option is already in clears it. Each writes the same provider state the
// classic filter UI does, so both stay in step and the URL carries either.
//
// scientificNameMatches are WoRMS hits for the current term, which only the
// API can produce; the picked names are always offered so they can be removed.
// typedRange is a time or depth range read off the term (see parseRangeQuery):
// its group is `pinned`, offered as typed rather than matched against it.
export default function useFilterSearchOptions(
  scientificNameMatches = [],
  typedRange,
) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("fr") ? "fr" : "en";
  const filters = useFilters();
  const { dataLayerChoices, toggleDataLayer, requestDraw } = useMapState();
  const {
    polygon,
    datasetTitleSearchText,
    setDatasetTitleSearchText,
    onlyInView,
    setOnlyInView,
  } = useSelection();
  const [canReset, resetAll] = useResetAllFilters();

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

  const toggleOnly = (id, label, description, on, set) => ({
    id,
    label,
    description,
    state: on ? "include" : undefined,
    includeOnly: true,
    toggle: () => set(!on),
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

  const rangeGroup = (key, label, current, defaults, set, unit = "") => {
    const typed = typedRange?.key === key;
    const [start, end] = typed ? [typedRange.start, typedRange.end] : current;
    const active = current[0] !== defaults[0] || current[1] !== defaults[1];
    const applied = active && start === current[0] && end === current[1];
    return {
      key,
      label,
      pinned: typed,
      options:
        typed || active
          ? [
              {
                id: key,
                label: `${start} – ${end}${unit}`,
                state: applied ? "include" : undefined,
                includeOnly: true,
                toggle: () => (applied ? set(...defaults) : set(start, end)),
              },
            ]
          : [],
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
    },
    {
      key: "quick",
      label: t("topBarQuickFiltersLabel"),
      options: [
        toggleOnly(
          "realtime",
          t("realtimeFilterOptionText"),
          t("quickFilterRealtimeTitle"),
          filters.realtimeOnly,
          filters.setRealtimeOnly,
        ),
        toggleOnly(
          "inView",
          t("datasetsCardOnlyInViewText"),
          t("quickFilterInViewTitle"),
          onlyInView,
          setOnlyInView,
        ),
      ],
    },
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
      " m",
    ),
    {
      key: "eovs",
      label: t("oceanVariablesFiltername"),
      // The catalogue names variables by code (subSurfaceTemperature); their
      // readable names, in both languages, are in eovs.json. Both are matched,
      // so a variable is found by its name in either language.
      options: listOptions(
        filters.eovsSelected,
        filters.setEovsSelected,
        true,
      ).map((option, i) => {
        const eov = eovsJSONfile.find(
          (e) => e.value === filters.eovsSelected[i].title,
        );
        if (!eov) return option;
        return {
          ...option,
          label: eov[lang === "fr" ? "label FR" : "label EN"],
          matchText: `${eov["label EN"]} ${eov["label FR"]}`,
        };
      }),
    },
    {
      key: "platforms",
      label: t("platformsFilterName"),
      options: listOptions(
        filters.platformsSelected,
        filters.setPlatformsSelected,
        true,
      ),
    },
    {
      key: "orgs",
      label: t("organizationFilterName"),
      options: listOptions(
        filters.orgsSelected,
        filters.setOrgsSelected,
        false,
      ),
    },
    {
      key: "sources",
      label: t("sourceFilterName"),
      // pk values collide between the two lists, hence the prefixed ids.
      options: [
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
    },
    {
      key: "dataLayers",
      label: t("layerSelectorLabel"),
      options: DATA_LAYER_KEYS.map((key) => ({
        id: key,
        label: t(DATA_LAYER_LABEL_KEYS[key]),
        description: t(DATA_LAYER_HINT_KEYS[key]),
        state: dataLayerChoices[key],
        toggle: (target) => toggleDataLayer(key, target),
      })),
    },
    filters.obisDataAvailable && {
      key: "scientificName",
      label: t("scientificNameFilterName"),
      options: [
        ...scientificNames.map((name) => scientificNameOption(name)),
        ...scientificNameMatches
          .filter((m) => !scientificNames.includes(m.scientificName))
          .map((m) => scientificNameOption(m.scientificName, m)),
      ],
    },
    {
      key: "datasets",
      label: t("datasetsFilterName"),
      options: listOptions(
        filters.datasetsSelected,
        filters.setDatasetsSelected,
        true,
      ),
    },
    // After the catalogue's values, which a few loosely matched letters
    // ("oxyg" for "Polygon") should not push down.
    {
      key: "area",
      label: t("spatialFilterFilterName"),
      options: [
        areaOption("box", t("drawBoundingBoxOption"), boxDrawn),
        areaOption(
          "polygon",
          t("drawPolygonOption"),
          Boolean(polygon) && !boxDrawn,
        ),
      ],
    },
    canReset && {
      key: "reset",
      label: t("quickFilterCaptionReset"),
      options: [
        {
          id: "reset",
          label: t("filterSearchClearAll"),
          matchText: `${t("filterSearchClearAll")} ${t("quickFilterCaptionReset")}`,
          includeOnly: true,
          command: true,
          action: t("quickFilterCaptionReset"),
          toggle: resetAll,
        },
      ],
    },
  ].filter(Boolean);
}
