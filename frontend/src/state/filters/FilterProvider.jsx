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

import fetchJson from "../fetchJson.js";
import reportError from "../reportError.js";

import platformsJSONfile from "../../platforms.json";
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
  capitalizeFirstLetter,
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
  eovsMatchAll: false,
  orgsMatchAll: false,
  scientificNamesExcluded: defaultScientificNamesSelected,
  scientificNamesMatchAll: false,
};

export default function FilterProvider({ children }) {
  const { t, i18n } = useTranslation();

  const [eovsSelected, setEovsSelected] = useState(defaultEovsSelected);
  const debouncedEovsSelected = useDebounce(eovsSelected, 500);
  const [eovsSearchTerms, setEovsSearchTerms] = useState("");
  // Any (default) or All of the included options, on the lists where a
  // dataset can carry several values. Not debounced, like realtimeOnly.
  const [eovsMatchAll, setEovsMatchAll] = useState(false);

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

  // Source filter (ERDDAP servers + OBIS nodes): the two lists stay separate
  // under the hood — they map to different API parameters — but render as a
  // single "Data Source" filter.
  const [erddapServerSelections, setErddapServersSelected] = useState(
    defaultErddapServersSelected,
  );
  // Only `url` and `isSelected` are stored; the label is a function of the
  // language, so it is applied here instead of being mirrored into the
  // selections by an effect that re-ran on every language switch.
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

  // Not debounced: a single toggle, unlike the list filters where a burst of
  // clicks would otherwise fire a request each.
  const [realtimeOnly, setRealtimeOnly] = useState(defaultRealtimeOnly);

  const [startDate, setStartDate] = useState(defaultStartDate);
  const debouncedStartDate = useDebounce(startDate, 500);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const debouncedEndDate = useDebounce(endDate, 500);

  const [startDepth, setStartDepth] = useState(defaultStartDepth);
  const debouncedStartDepth = useDebounce(startDepth, 500);
  const [endDepth, setEndDepth] = useState(defaultEndDepth);
  const debouncedEndDepth = useDebounce(endDepth, 500);

  // Scientific name filter (OBIS only)
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
  // OBIS data is shown unless the source filter is active without any OBIS
  // node selected, or excludes every node. Drives the scientific-name filter's
  // disabled state.
  const showObis =
    (!anyServersSelected || anyObisNodesSelected) && !allObisNodesExcluded;
  // No OBIS nodes returned from /obisNodes means the database has no OBIS data,
  // so OBIS-only UI (the Scientific Name filter) is hidden entirely.
  const obisDataAvailable = obisNodesSelected.length > 0;

  // The query every fetch in the app is keyed on. Built straight from the
  // debounced selections rather than mirrored into state by an effect keyed on
  // them: useDebounce is a trailing debounce, so at the moment it fires the
  // debounced value already equals the live one, and a memo over the same
  // inputs lands the same object one render earlier and with no extra pass.
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
      // Scientific name only applies to OBIS data; when OBIS isn't shown the
      // filter is disabled in the UI, so don't apply stale selections to the
      // query (the selection state is preserved for when OBIS is re-enabled).
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

  // How much observation time the current selection actually covers, which is
  // what the time slider draws its axis over — there is no point handing a
  // hundred years of rail to a selection that starts in 2012.
  //
  // The time filter is left out of the request on purpose: the extent is what
  // a time selection is made against, so letting the selection narrow it would
  // walk the axis inwards on every drag. Leaving it out also makes the URL
  // stable while the user scrubs, so changing dates costs no fetch at all.
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
        // A selection matching nothing comes back as nulls; keep the axis as
        // it is rather than collapsing it to an empty domain.
        if (!cancelled && extent?.min && extent?.max) setTimeExtent(extent);
      })
      .catch((error) => {
        // The axis falls back to the full filterable domain, so this is a
        // cosmetic loss — never a reason to break the bar.
        reportError("time extent fetch failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [extentQueryString]);

  // "Is this filter doing anything?" is just the selection compared with the
  // defaults, so it is derived during render rather than mirrored into state
  // by an effect keyed on the debounced query. That effect left a window —
  // one debounce long — where the dates had moved but the flag had not, and
  // TimeRail reads the two together to size its axis.
  const timeFilterActive =
    startDate !== defaultStartDate || endDate !== defaultEndDate;
  const depthFilterActive =
    startDepth !== defaultStartDepth || endDepth !== defaultEndDepth;

  // Set when any catalog fetch fails (e.g. API gateway timeouts) so the UI
  // can surface a retry instead of silently empty filters.
  const [catalogError, setCatalogError] = useState(false);
  // Set once all catalog fetches have settled (successfully or not) — lets
  // consumers distinguish "still loading" from "loaded but empty".
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  // One-shot catalog fetches, seeded with any selections carried in the URL
  // so share links hydrate the filters. Retryable via loadCatalog().
  const loadCatalog = useCallback(() => {
    setCatalogError(false);
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
    if (eovsMatch === "all") setEovsMatchAll(true);
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

    /* /platforms returns array of platform names:
      ['abc', 'def', ...]
    */
    const platformsRequest = fetchJson(`${server}/platforms`).then(
      (platforms) => {
        setPlatformsSelected(
          platforms.map((platform) => {
            const platformMetadata = platformsJSONfile.find(
              (p) => p.label_en === platform,
            );

            return {
              title: platform,
              pk: platform,
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
          const category = eovMetadata?.category || "Other";

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

    // OBIS nodes — distinct list from /obisNodes. Names double as the pk
    // since the schema stores text[] (no per-node lookup table).
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
    // "ERDDAP data only" — that now reads as every server selected.
    const selectAllServers =
      includeObis === "false" && erddapServersFromURL.length === 0;

    const erddapServersRequest = fetchJson(`${server}/erddapServers`).then(
      (servers) => {
        setErddapServersSelected(
          servers
            // OBIS datasets carry https://obis.org as their erddap_url
            // sentinel; OBIS is represented by its node group instead.
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

    // Surface a retry banner if anything failed — the API responding with
    // gateway timeouts leaves filters empty and the app unusable otherwise.
    // 4xx responses (e.g. an older API without /obisNodes) mean the endpoint
    // is absent, not that the service is down, so they only log.
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
      if (serviceDown) setCatalogError(true);
      setCatalogLoaded(true);
    });
    // Reads the URL and module-level config only — nothing from this render.
  }, []);

  useEffect(() => {
    // Kicking off the catalogue fetches is the one thing this provider has to
    // do on mount, and loadCatalog clears the retry banner before it starts.
    // That clear is a synchronous setState in an effect body, which is what
    // the rule is about; there is no cascade to avoid here, since the flag is
    // already false on the render that runs this.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCatalog();
  }, [loadCatalog]);

  function resetFilters() {
    setRealtimeOnly(defaultRealtimeOnly);
    setEovsMatchAll(false);
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

  // Human label for a single multi-select option, matching how
  // MultiCheckboxFilter renders it (translated title where available).
  const optionLabel = (option, translatable) => {
    let title = option.title;
    if (translatable) {
      if (
        option.titleTranslated &&
        option.titleTranslated[i18n.languages[0]] &&
        option.titleTranslated[i18n.languages[1]]
      ) {
        title = option.titleTranslated[i18n.language];
      } else if (t(option.title)) {
        title = t(option.title);
      }
    }
    return capitalizeFirstLetter(title);
  };

  const value = {
    query,
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
    catalogLoaded,
    loadCatalog,
  };

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  );
}
