import * as React from "react";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import { eovCategory } from "../datasetGroups.js";
import fetchJson from "../fetchJson.js";
import reportError from "../reportError.js";

import platformsJSONfile from "../../platforms.json";
import { platformCategory, platformLabels } from "../../platformVocab.js";
// Both copied verbatim from cioos-commons/eovs/ (eov.json, categories.json).
import eovsJSONfile from "../../eovs.json";
import eovCategoriesJSONfile from "../../eovCategories.json";
import erddapServersJSONfile from "../../erddapServers.json";
import { server } from "../../config.js";
import {
  defaultEovsSelected,
  defaultOrgsSelected,
  defaultStartDate,
  defaultEndDate,
  defaultStartDepth,
  defaultEndDepth,
  defaultDatatsetsSelected,
  defaultPlatformsSelected,
  defaultScientificNamesSelected,
  defaultObisNodesSelected,
  defaultErddapServersSelected,
  defaultRealtimeOnly,
} from "../../components/config.js";
import {
  filterOptionLabel,
  useDebounce,
  createDataFilterQueryString,
  formatErddapServerName,
} from "../../utilities.jsx";

const FilterContext = createContext();

export function useFilters() {
  return useContext(FilterContext);
}

export const defaultQuery = {
  startDate: defaultStartDate,
  endDate: defaultEndDate,
  startDepth: defaultStartDepth,
  endDepth: defaultEndDepth,
  eovsSelected: defaultEovsSelected,
  orgsSelected: defaultOrgsSelected,
  datasetsSelected: defaultDatatsetsSelected,
  platformsSelected: defaultPlatformsSelected,
  scientificNamesSelected: defaultScientificNamesSelected,
  obisNodesSelected: defaultObisNodesSelected,
  erddapServersSelected: defaultErddapServersSelected,
  realtimeOnly: defaultRealtimeOnly,
  eovsMatchAll: true,
  orgsMatchAll: false,
  scientificNamesExcluded: defaultScientificNamesSelected,
  scientificNamesMatchAll: false,
};

export default function FilterProvider({ children }) {
  const { t, i18n } = useTranslation();

  const [eovsSelected, setEovsSelected] = useState(defaultEovsSelected);
  const debouncedEovsSelected = useDebounce(eovsSelected, 500);
  const [eovsSearchTerms, setEovsSearchTerms] = useState("");
  // Not debounced, like realtimeOnly.
  const [eovsMatchAll, setEovsMatchAll] = useState(true);

  const [orgsSelected, setOrgsSelected] = useState(defaultOrgsSelected);
  const debouncedOrgsSelected = useDebounce(orgsSelected, 500);
  const [orgsSearchTerms, setOrgsSearchTerms] = useState("");
  const [orgsMatchAll, setOrgsMatchAll] = useState(false);

  const [datasetsSelected, setDatasetsSelected] = useState(
    defaultDatatsetsSelected,
  );
  const debouncedDatasetsSelected = useDebounce(datasetsSelected, 500);
  const [datasetSearchTerms, setDatasetSearchTerms] = useState("");

  const [platformsSelected, setPlatformsSelected] = useState(
    defaultPlatformsSelected,
  );
  const debouncedPlatformsSelected = useDebounce(platformsSelected, 500);
  const [platformsSearchTerms, setPlatformsSearchTerms] = useState("");

  // Two lists because they map to different API parameters, rendered as one
  // "Data Source" filter.
  const [erddapServerSelections, setErddapServersSelected] = useState(
    defaultErddapServersSelected,
  );
  // Only `url` and `isSelected` are stored; the label depends on the language.
  const erddapServersSelected = useMemo(
    () =>
      erddapServerSelections.map((server) => ({
        ...server,
        title: formatErddapServerName(
          server.url,
          i18n.language,
          erddapServersJSONfile,
        ),
      })),
    [erddapServerSelections, i18n.language],
  );
  const debouncedErddapServersSelected = useDebounce(
    erddapServersSelected,
    500,
  );
  const [obisNodesSelected, setObisNodesSelected] = useState(
    defaultObisNodesSelected,
  );
  const debouncedObisNodesSelected = useDebounce(obisNodesSelected, 500);
  const [sourcesSearchTerms, setSourcesSearchTerms] = useState("");

  // Not debounced: a single toggle, unlike the list filters.
  const [realtimeOnly, setRealtimeOnly] = useState(defaultRealtimeOnly);

  const [startDate, setStartDate] = useState(defaultStartDate);
  const debouncedStartDate = useDebounce(startDate, 500);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const debouncedEndDate = useDebounce(endDate, 500);

  const [startDepth, setStartDepth] = useState(defaultStartDepth);
  const debouncedStartDepth = useDebounce(startDepth, 500);
  const [endDepth, setEndDepth] = useState(defaultEndDepth);
  const debouncedEndDepth = useDebounce(endDepth, 500);

  const [scientificNamesSelected, setScientificNamesSelected] = useState(
    defaultScientificNamesSelected,
  );
  const debouncedScientificNamesSelected = useDebounce(
    scientificNamesSelected,
    500,
  );
  const [scientificNamesExcluded, setScientificNamesExcluded] = useState(
    defaultScientificNamesSelected,
  );
  const debouncedScientificNamesExcluded = useDebounce(
    scientificNamesExcluded,
    500,
  );
  const [scientificNamesMatchAll, setScientificNamesMatchAll] = useState(false);

  const [totalNumberOfDatasets, setTotalNumberOfDatasets] = useState();

  const anyServersSelected = erddapServersSelected.some((s) => s.isSelected);
  const anyObisNodesSelected = obisNodesSelected.some((n) => n.isSelected);
  const allObisNodesSelected =
    obisNodesSelected.length > 0 &&
    obisNodesSelected.every((n) => n.isSelected);
  const allObisNodesExcluded =
    obisNodesSelected.length > 0 &&
    obisNodesSelected.every((n) => n.isExcluded);
  const showObis =
    (!anyServersSelected || anyObisNodesSelected) && !allObisNodesExcluded;
  // An empty /obisNodes means no OBIS data, so OBIS-only UI is hidden.
  const obisDataAvailable = obisNodesSelected.length > 0;

  // Between an edit and its debounce firing, results still answer the old
  // selection.
  const filtersPending =
    eovsSelected !== debouncedEovsSelected ||
    orgsSelected !== debouncedOrgsSelected ||
    datasetsSelected !== debouncedDatasetsSelected ||
    platformsSelected !== debouncedPlatformsSelected ||
    erddapServersSelected !== debouncedErddapServersSelected ||
    obisNodesSelected !== debouncedObisNodesSelected ||
    startDate !== debouncedStartDate ||
    endDate !== debouncedEndDate ||
    startDepth !== debouncedStartDepth ||
    endDepth !== debouncedEndDepth ||
    scientificNamesSelected !== debouncedScientificNamesSelected ||
    scientificNamesExcluded !== debouncedScientificNamesExcluded;

  // A memo, not effect-mirrored state: at the moment the trailing debounce
  // fires the debounced value equals the live one, so this lands one render
  // earlier with no extra pass.
  const query = useMemo(
    () => ({
      startDate: debouncedStartDate,
      endDate: debouncedEndDate,
      startDepth: debouncedStartDepth,
      endDepth: debouncedEndDepth,
      eovsSelected: debouncedEovsSelected,
      orgsSelected: debouncedOrgsSelected,
      datasetsSelected: debouncedDatasetsSelected,
      platformsSelected: debouncedPlatformsSelected,
      // Stale selections are kept in state for when OBIS is re-enabled.
      scientificNamesSelected: showObis ? debouncedScientificNamesSelected : [],
      scientificNamesExcluded: showObis ? debouncedScientificNamesExcluded : [],
      obisNodesSelected: debouncedObisNodesSelected,
      erddapServersSelected: debouncedErddapServersSelected,
      realtimeOnly,
      eovsMatchAll,
      orgsMatchAll,
      scientificNamesMatchAll,
    }),
    [
      debouncedStartDate,
      debouncedEndDate,
      debouncedStartDepth,
      debouncedEndDepth,
      debouncedEovsSelected,
      debouncedOrgsSelected,
      debouncedDatasetsSelected,
      debouncedPlatformsSelected,
      debouncedScientificNamesSelected,
      debouncedScientificNamesExcluded,
      debouncedObisNodesSelected,
      debouncedErddapServersSelected,
      realtimeOnly,
      eovsMatchAll,
      orgsMatchAll,
      scientificNamesMatchAll,
      showObis,
    ],
  );

  // The time slider's axis. The time filter is left out of the request on
  // purpose: the selection is made against the extent, so letting it narrow
  // the extent would walk the axis inwards on every drag (and cost a fetch).
  const [timeExtent, setTimeExtent] = useState();
  const extentQueryString = useMemo(() => {
    if (isEmpty(query)) return undefined;
    const params = new URLSearchParams(createDataFilterQueryString(query));
    params.delete("timeMin");
    params.delete("timeMax");
    return params.toString();
  }, [query]);

  useEffect(() => {
    if (extentQueryString === undefined) return undefined;
    let cancelled = false;
    fetchJson(
      `${server}/timeExtent${extentQueryString ? "?" + extentQueryString : ""}`,
    )
      .then((extent) => {
        // A selection matching nothing comes back as nulls; keep the axis.
        if (!cancelled && extent?.min && extent?.max) setTimeExtent(extent);
      })
      .catch((error) => {
        // The axis falls back to the full domain, so this is cosmetic.
        reportError("time extent fetch failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [extentQueryString]);

  // Derived during render: an effect on the debounced query left a window
  // where the dates had moved but the flag had not, and TimeRail reads both.
  const timeFilterActive =
    startDate !== defaultStartDate || endDate !== defaultEndDate;
  const depthFilterActive =
    startDepth !== defaultStartDepth || endDepth !== defaultEndDepth;

  // So the UI can offer a retry instead of silently empty filters.
  const [catalogError, setCatalogError] = useState(false);
  const [catalogErrorDetail, setCatalogErrorDetail] = useState(null);
  // Distinguishes "still loading" from "loaded but empty".
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // Seeded with any selections carried in the URL. Retryable via loadCatalog().
  const loadCatalog = useCallback(() => {
    setCatalogError(false);
    setCatalogErrorDetail(null);
    const filtersFromURL = Object.fromEntries(
      new URL(window.location.href).searchParams,
    );
    const {
      timeMin,
      timeMax,
      depthMin,
      depthMax,
      datasetPKs,
      organizations,
      platforms,
      eovs,
      erddapServers,
      includeObis,
      scientificNames,
      obisNodes,
      realtimeOnly: realtimeOnlyFromURL,
      eovsMatch,
      organizationsMatch,
      scientificNamesMatch,
      excludeEovs,
      excludePlatforms,
      excludeOrganizations,
      excludeDatasetPKs,
      excludeErddapServers,
      excludeObisNodes,
      excludeScientificNames,
    } = filtersFromURL;

    const namesFromURL = (list) =>
      list
        .split(",")
        .map((name) => decodeURIComponent(name))
        .filter(Boolean);
    if (scientificNames)
      setScientificNamesSelected(namesFromURL(scientificNames));
    if (excludeScientificNames) {
      setScientificNamesExcluded(namesFromURL(excludeScientificNames));
    }
    if (realtimeOnlyFromURL === "true") setRealtimeOnly(true);
    // Links from before AND became the default leave the param off for OR.
    if (eovs?.split(",").filter(Boolean).length > 1) {
      setEovsMatchAll(eovsMatch === "all");
    }
    if (organizationsMatch === "all") setOrgsMatchAll(true);
    if (scientificNamesMatch === "all") setScientificNamesMatchAll(true);
    if (timeMin) setStartDate(timeMin);
    if (timeMax) setEndDate(timeMax);
    if (depthMin && Number.parseInt(depthMin) > 0) {
      setStartDepth(Number.parseInt(depthMin));
    }
    if (depthMax && Number.parseInt(depthMax) > 0) {
      setEndDepth(Number.parseInt(depthMax));
    }
    const platformsFromURL = platforms?.split(",") || [];
    const platformsExcludedFromURL = excludePlatforms?.split(",") || [];

    const platformsRequest = fetchJson(`${server}/platforms`).then(
      (platforms) => {
        setPlatformsSelected(
          platforms.map((platform) => {
            const platformMetadata = platformsJSONfile.find(
              (p) => p.label_en === platform,
            );

            const category = platformCategory(platform);
            return {
              title: platform,
              titleTranslated: platformLabels(platform),
              pk: platform,
              category,
              categoryTranslated: platformLabels(category),
              isSelected: platformsFromURL.includes(platform),
              isExcluded: platformsExcludedFromURL.includes(platform),
              hover_en: platformMetadata?.definition_en,
              hover_fr: platformMetadata?.definition_fr,
            };
          }),
        );
      },
    );

    const eovsFromURL = eovs?.split(",") || [];
    const eovsExcludedFromURL = excludeEovs?.split(",") || [];

    const eovsRequest = fetchJson(`${server}/oceanVariables`).then((eovs) => {
      setEovsSelected(
        eovs.map((eov, index) => {
          const eovMetadata = eovsJSONfile.find((e) => e.value === eov);
          const category = eovCategory(eov);

          return {
            title: eov,
            isSelected: eovsFromURL.includes(eov),
            isExcluded: eovsExcludedFromURL.includes(eov),
            pk: index,
            category,
            categoryTranslated: eovCategoriesJSONfile[category],
            hover_en: eovMetadata?.["definition EN"],
            hover_fr: eovMetadata?.["definition FR"],
          };
        }),
      );
    });

    const orgsFromURL = (organizations?.split(",") || []).map((e) =>
      Number.parseInt(e),
    );
    const orgsExcludedFromURL = (excludeOrganizations?.split(",") || []).map(
      (e) => Number.parseInt(e),
    );

    const orgsRequest = fetchJson(`${server}/organizations`).then((orgsR) => {
      setOrgsSelected(
        orgsR.map((org) => {
          return {
            title: org.name,
            isSelected: orgsFromURL.includes(org.pk),
            isExcluded: orgsExcludedFromURL.includes(org.pk),
            pk: org.pk,
          };
        }),
      );
    });

    // Names double as the pk: the schema stores text[], no per-node table.
    const obisNodesFromURL = (obisNodes?.split(",") || []).map((s) =>
      decodeURIComponent(s),
    );
    const obisNodesExcludedFromURL = (excludeObisNodes?.split(",") || []).map(
      (s) => decodeURIComponent(s),
    );
    const obisNodesRequest = fetchJson(`${server}/obisNodes`).then((nodesR) => {
      setObisNodesSelected(
        nodesR.map((node) => ({
          title: node.name,
          isSelected: obisNodesFromURL.includes(node.name),
          isExcluded: obisNodesExcludedFromURL.includes(node.name),
          pk: node.name,
        })),
      );
    });

    const datasetsFromURL = (datasetPKs?.split(",") || []).map((e) =>
      Number.parseInt(e),
    );
    const datasetsExcludedFromURL = (excludeDatasetPKs?.split(",") || []).map(
      (e) => Number.parseInt(e),
    );

    const datasetsRequest = fetchJson(`${server}/datasets`).then(
      (datasetsR) => {
        setTotalNumberOfDatasets((current) =>
          isEmpty(current) ? datasetsR.length : current,
        );
        setDatasetsSelected(
          datasetsR.map((dataset) => {
            return {
              title: dataset.title,
              titleTranslated: dataset.title_translated,
              platform: dataset.platform,
              isSelected: datasetsFromURL.includes(dataset.pk),
              isExcluded: datasetsExcludedFromURL.includes(dataset.pk),
              pk: dataset.pk,
            };
          }),
        );
      },
    );

    const erddapServersFromURL = erddapServers?.split(",") || [];
    const erddapServersExcludedFromURL = excludeErddapServers?.split(",") || [];
    // Legacy share links used includeObis=false with no server list to mean
    // "ERDDAP data only", which now reads as every server selected.
    const selectAllServers =
      includeObis === "false" && erddapServersFromURL.length === 0;

    const erddapServersRequest = fetchJson(`${server}/erddapServers`).then(
      (servers) => {
        setErddapServersSelected(
          servers
            // OBIS datasets carry https://obis.org as an erddap_url sentinel.
            .filter((serverUrl) => serverUrl !== "https://obis.org")
            .map((serverUrl, index) => ({
              url: serverUrl,
              isSelected:
                selectAllServers || erddapServersFromURL.includes(serverUrl),
              isExcluded: erddapServersExcludedFromURL.includes(serverUrl),
              pk: index,
            })),
        );
      },
    );

    // 4xx (e.g. an older API without /obisNodes) means the endpoint is absent,
    // not that the service is down, so it only logs.
    Promise.allSettled([
      platformsRequest,
      eovsRequest,
      orgsRequest,
      obisNodesRequest,
      datasetsRequest,
      erddapServersRequest,
    ]).then((results) => {
      const failed = results.filter((r) => r.status === "rejected");
      failed.forEach((r) => console.error("catalog fetch failed:", r.reason));
      const serviceDown = failed.some(
        (r) => !r.reason?.status || r.reason.status >= 500,
      );
      if (serviceDown) {
        setCatalogError(true);
        setCatalogErrorDetail(
          failed.find((r) => r.reason?.detail)?.reason.detail ?? null,
        );
      }
      setCatalogLoaded(true);
    });
  }, []);

  useEffect(() => {
    // loadCatalog clears the retry banner synchronously; the flag is already
    // false on this render, so there is no cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCatalog();
  }, [loadCatalog]);

  function resetFilters() {
    setRealtimeOnly(defaultRealtimeOnly);
    setEovsMatchAll(true);
    setOrgsMatchAll(false);
    setScientificNamesMatchAll(false);
    setStartDate(defaultStartDate);
    setEndDate(defaultEndDate);
    setStartDepth(defaultStartDepth);
    setEndDepth(defaultEndDepth);
    setEovsSelected(
      eovsSelected.map((eov) => {
        return { ...eov, isSelected: false, isExcluded: false };
      }),
    );
    setOrgsSelected(
      orgsSelected.map((org) => {
        return { ...org, isSelected: false, isExcluded: false };
      }),
    );
    setDatasetsSelected(
      datasetsSelected.map((dataset) => {
        return { ...dataset, isSelected: false, isExcluded: false };
      }),
    );
    setPlatformsSelected(
      platformsSelected.map((platform) => {
        return { ...platform, isSelected: false, isExcluded: false };
      }),
    );
    setErddapServersSelected(
      erddapServersSelected.map((server) => {
        return { ...server, isSelected: false, isExcluded: false };
      }),
    );
    setObisNodesSelected(
      obisNodesSelected.map((node) => {
        return { ...node, isSelected: false, isExcluded: false };
      }),
    );
    setScientificNamesSelected([]);
    setScientificNamesExcluded([]);
  }

  const optionLabel = (option, translatable) =>
    filterOptionLabel(option, translatable, t, i18n.language);

  const value = {
    query,
    filtersPending,
    eovsSelected,
    setEovsSelected,
    eovsSearchTerms,
    setEovsSearchTerms,
    orgsSelected,
    setOrgsSelected,
    orgsSearchTerms,
    setOrgsSearchTerms,
    datasetsSelected,
    setDatasetsSelected,
    datasetSearchTerms,
    setDatasetSearchTerms,
    platformsSelected,
    setPlatformsSelected,
    platformsSearchTerms,
    setPlatformsSearchTerms,
    erddapServersSelected,
    setErddapServersSelected,
    obisNodesSelected,
    setObisNodesSelected,
    sourcesSearchTerms,
    setSourcesSearchTerms,
    realtimeOnly,
    setRealtimeOnly,
    eovsMatchAll,
    setEovsMatchAll,
    orgsMatchAll,
    setOrgsMatchAll,
    scientificNamesMatchAll,
    setScientificNamesMatchAll,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    startDepth,
    setStartDepth,
    endDepth,
    setEndDepth,
    scientificNamesSelected,
    setScientificNamesSelected,
    scientificNamesExcluded,
    setScientificNamesExcluded,
    timeFilterActive,
    timeExtent,
    depthFilterActive,
    anyServersSelected,
    anyObisNodesSelected,
    allObisNodesSelected,
    allObisNodesExcluded,
    showObis,
    obisDataAvailable,
    totalNumberOfDatasets,
    resetFilters,
    optionLabel,
    catalogError,
    catalogErrorDetail,
    catalogLoaded,
    loadCatalog,
  };

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}
