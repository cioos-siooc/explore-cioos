import * as React from 'react'
import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import isEmpty from 'lodash/isEmpty'

import fetchJson from '../fetchJson.js'
import reportError from '../reportError.js'

import platformsJSONfile from '../../platforms.json'
import eovsJSONfile from '../../eovs.json'
import erddapServersJSONfile from '../../erddapServers.json'
import { server } from '../../config.js'
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
  defaultErddapServersSelected
} from '../../components/config.js'
import {
  capitalizeFirstLetter,
  useDebounce,
  setAllOptionsIsSelectedTo,
  createDataFilterQueryString
} from '../../utilities.jsx'

const FilterContext = createContext()

export function useFilters () {
  return useContext(FilterContext)
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
  erddapServersSelected: defaultErddapServersSelected
}

export default function FilterProvider ({ children }) {
  const { t, i18n } = useTranslation()

  const [query, setQuery] = useState(defaultQuery)

  const [eovsSelected, setEovsSelected] = useState(defaultEovsSelected)
  const debouncedEovsSelected = useDebounce(eovsSelected, 500)
  const [eovsSearchTerms, setEovsSearchTerms] = useState('')

  const [orgsSelected, setOrgsSelected] = useState(defaultOrgsSelected)
  const debouncedOrgsSelected = useDebounce(orgsSelected, 500)
  const [orgsSearchTerms, setOrgsSearchTerms] = useState('')

  const [datasetsSelected, setDatasetsSelected] = useState(
    defaultDatatsetsSelected
  )
  const debouncedDatasetsSelected = useDebounce(datasetsSelected, 500)
  const [datasetSearchTerms, setDatasetSearchTerms] = useState('')

  const [platformsSelected, setPlatformsSelected] = useState(
    defaultPlatformsSelected
  )
  const debouncedPlatformsSelected = useDebounce(platformsSelected, 500)
  const [platformsSearchTerms, setPlatformsSearchTerms] = useState('')

  // Source filter (ERDDAP servers + OBIS nodes): the two lists stay separate
  // under the hood — they map to different API parameters — but render as a
  // single "Data Source" filter.
  const [erddapServersSelected, setErddapServersSelected] = useState(
    defaultErddapServersSelected
  )
  const debouncedErddapServersSelected = useDebounce(erddapServersSelected, 500)
  const [obisNodesSelected, setObisNodesSelected] = useState(
    defaultObisNodesSelected
  )
  const debouncedObisNodesSelected = useDebounce(obisNodesSelected, 500)
  const [sourcesSearchTerms, setSourcesSearchTerms] = useState('')

  const [startDate, setStartDate] = useState(defaultStartDate)
  const debouncedStartDate = useDebounce(startDate, 500)
  const [endDate, setEndDate] = useState(defaultEndDate)
  const debouncedEndDate = useDebounce(endDate, 500)

  const [startDepth, setStartDepth] = useState(defaultStartDepth)
  const debouncedStartDepth = useDebounce(startDepth, 500)
  const [endDepth, setEndDepth] = useState(defaultEndDepth)
  const debouncedEndDepth = useDebounce(endDepth, 500)

  // Scientific name filter (OBIS only)
  const [scientificNamesSelected, setScientificNamesSelected] = useState(
    defaultScientificNamesSelected
  )
  const debouncedScientificNamesSelected = useDebounce(
    scientificNamesSelected,
    500
  )

  const [timeFilterActive, setTimeFilterActive] = useState(false)
  const [depthFilterActive, setDepthFilterActive] = useState(false)

  const [totalNumberOfDatasets, setTotalNumberOfDatasets] = useState()

  const anyServersSelected = erddapServersSelected.some((s) => s.isSelected)
  const anyObisNodesSelected = obisNodesSelected.some((n) => n.isSelected)
  const allObisNodesSelected =
    obisNodesSelected.length > 0 && obisNodesSelected.every((n) => n.isSelected)
  // OBIS data is shown unless the source filter is active without any OBIS
  // node selected. Drives the scientific-name filter's disabled state.
  const showObis = !anyServersSelected || anyObisNodesSelected
  // No OBIS nodes returned from /obisNodes means the database has no OBIS data,
  // so OBIS-only UI (the Scientific Name filter) is hidden entirely.
  const obisDataAvailable = obisNodesSelected.length > 0

  // Update query
  useEffect(() => {
    setQuery({
      startDate,
      endDate,
      startDepth,
      endDepth,
      eovsSelected,
      orgsSelected,
      datasetsSelected,
      platformsSelected,
      // Scientific name only applies to OBIS data; when OBIS isn't shown the
      // filter is disabled in the UI, so don't apply stale selections to the
      // query (the selection state is preserved for when OBIS is re-enabled).
      scientificNamesSelected: showObis ? scientificNamesSelected : [],
      obisNodesSelected,
      erddapServersSelected
    })
  }, [
    debouncedStartDate,
    debouncedEndDate,
    debouncedStartDepth,
    debouncedEndDepth,
    debouncedEovsSelected,
    debouncedOrgsSelected,
    debouncedDatasetsSelected,
    debouncedPlatformsSelected,
    debouncedScientificNamesSelected,
    debouncedObisNodesSelected,
    debouncedErddapServersSelected,
    showObis
  ])

  // How much observation time the current selection actually covers, which is
  // what the time slider draws its axis over — there is no point handing a
  // hundred years of rail to a selection that starts in 2012.
  //
  // The time filter is left out of the request on purpose: the extent is what
  // a time selection is made against, so letting the selection narrow it would
  // walk the axis inwards on every drag. Leaving it out also makes the URL
  // stable while the user scrubs, so changing dates costs no fetch at all.
  const [timeExtent, setTimeExtent] = useState()
  const extentQueryString = useMemo(() => {
    if (isEmpty(query)) return undefined
    const params = new URLSearchParams(createDataFilterQueryString(query))
    params.delete('timeMin')
    params.delete('timeMax')
    return params.toString()
  }, [query])

  useEffect(() => {
    if (extentQueryString === undefined) return undefined
    let cancelled = false
    fetchJson(
      `${server}/timeExtent${extentQueryString ? '?' + extentQueryString : ''}`
    )
      .then((extent) => {
        // A selection matching nothing comes back as nulls; keep the axis as
        // it is rather than collapsing it to an empty domain.
        if (!cancelled && extent?.min && extent?.max) setTimeExtent(extent)
      })
      .catch((error) => {
        // The axis falls back to the full filterable domain, so this is a
        // cosmetic loss — never a reason to break the bar.
        reportError('time extent fetch failed', error)
      })
    return () => {
      cancelled = true
    }
  }, [extentQueryString])

  useEffect(() => {
    setTimeFilterActive(
      startDate !== defaultStartDate || endDate !== defaultEndDate
    )
    setDepthFilterActive(
      startDepth !== defaultStartDepth || endDepth !== defaultEndDepth
    )
  }, [query])

  // Update ERDDAP server names when language changes
  useEffect(() => {
    if (erddapServersSelected.length > 0) {
      setErddapServersSelected(
        erddapServersSelected.map((server) => {
          const serverMetadata = erddapServersJSONfile.find(
            (s) => s.url === server.url
          )
          return {
            ...server,
            title: serverMetadata
              ? i18n.language === 'fr'
                ? serverMetadata.label_fr
                : serverMetadata.label_en
              : server.url
          }
        })
      )
    }
  }, [i18n.language])

  // Set when any catalog fetch fails (e.g. API gateway timeouts) so the UI
  // can surface a retry instead of silently empty filters.
  const [catalogError, setCatalogError] = useState(false)
  // Set once all catalog fetches have settled (successfully or not) — lets
  // consumers distinguish "still loading" from "loaded but empty".
  const [catalogLoaded, setCatalogLoaded] = useState(false)

  // One-shot catalog fetches, seeded with any selections carried in the URL
  // so share links hydrate the filters. Retryable via loadCatalog().
  function loadCatalog () {
    setCatalogError(false)
    const filtersFromURL = Object.fromEntries(
      new URL(window.location.href).searchParams
    )
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
      obisNodes
    } = filtersFromURL

    if (scientificNames) {
      setScientificNamesSelected(
        scientificNames
          .split(',')
          .map((name) => decodeURIComponent(name))
          .filter(Boolean)
      )
    }
    if (timeMin) setStartDate(timeMin)
    if (timeMax) setEndDate(timeMax)
    if (depthMin && Number.parseInt(depthMin) > 0) {
      setStartDepth(Number.parseInt(depthMin))
    }
    if (depthMax && Number.parseInt(depthMax) > 0) {
      setEndDepth(Number.parseInt(depthMax))
    }
    const platformsFromURL = platforms?.split(',') || []

    /* /platforms returns array of platform names:
      ['abc', 'def', ...]
    */
    const platformsRequest = fetchJson(`${server}/platforms`).then(
      (platforms) => {
        setPlatformsSelected(
          platforms.map((platform, index) => {
            const platformMetadata = platformsJSONfile.find(
              (p) => p.label_en === platform
            )

            return {
              title: platform,
              pk: platform,
              isSelected: platformsFromURL.includes(platform),
              hover_en: platformMetadata?.definition_en,
              hover_fr: platformMetadata?.definition_fr
            }
          })
        )
      }
    )

    const eovsFromURL = eovs?.split(',') || []

    const eovsRequest = fetchJson(`${server}/oceanVariables`).then((eovs) => {
      setEovsSelected(
        eovs.map((eov, index) => {
          const eovMetadata = eovsJSONfile.find((e) => e.value === eov)

          return {
            title: eov,
            isSelected: eovsFromURL.includes(eov),
            pk: index,
            hover_en: eovMetadata?.['definition EN'],
            hover_fr: eovMetadata?.['definition FR']
          }
        })
      )
    })

    const orgsFromURL = (organizations?.split(',') || []).map((e) =>
      Number.parseInt(e)
    )

    const orgsRequest = fetchJson(`${server}/organizations`).then((orgsR) => {
      setOrgsSelected(
        orgsR.map((org) => {
          return {
            title: org.name,
            isSelected: orgsFromURL.includes(org.pk),
            pk: org.pk
          }
        })
      )
    })

    // OBIS nodes — distinct list from /obisNodes. Names double as the pk
    // since the schema stores text[] (no per-node lookup table).
    const obisNodesFromURL = (obisNodes?.split(',') || []).map((s) =>
      decodeURIComponent(s)
    )
    const obisNodesRequest = fetchJson(`${server}/obisNodes`).then((nodesR) => {
      setObisNodesSelected(
        nodesR.map((node) => ({
          title: node.name,
          isSelected: obisNodesFromURL.includes(node.name),
          pk: node.name
        }))
      )
    })

    const datasetsFromURL = (datasetPKs?.split(',') || []).map((e) =>
      Number.parseInt(e)
    )

    const datasetsRequest = fetchJson(`${server}/datasets`).then(
      (datasetsR) => {
        setTotalNumberOfDatasets((current) =>
          isEmpty(current) ? datasetsR.length : current
        )
        setDatasetsSelected(
          datasetsR.map((dataset) => {
            return {
              title: dataset.title,
              titleTranslated: dataset.title_translated,
              platform: dataset.platform,
              isSelected: datasetsFromURL.includes(dataset.pk),
              pk: dataset.pk
            }
          })
        )
      }
    )

    const erddapServersFromURL = erddapServers?.split(',') || []
    // Legacy share links used includeObis=false with no server list to mean
    // "ERDDAP data only" — that now reads as every server selected.
    const selectAllServers =
      includeObis === 'false' && erddapServersFromURL.length === 0

    const erddapServersRequest = fetchJson(`${server}/erddapServers`).then(
      (servers) => {
        setErddapServersSelected(
          servers
            // OBIS datasets carry https://obis.org as their erddap_url
            // sentinel; OBIS is represented by its node group instead.
            .filter((serverUrl) => serverUrl !== 'https://obis.org')
            .map((serverUrl, index) => {
              const serverMetadata = erddapServersJSONfile.find(
                (s) => s.url === serverUrl
              )

              return {
                title: serverMetadata
                  ? i18n.language === 'fr'
                    ? serverMetadata.label_fr
                    : serverMetadata.label_en
                  : serverUrl,
                url: serverUrl,
                isSelected:
                  selectAllServers || erddapServersFromURL.includes(serverUrl),
                pk: index
              }
            })
        )
      }
    )

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
      erddapServersRequest
    ]).then((results) => {
      const failed = results.filter((r) => r.status === 'rejected')
      failed.forEach((r) => console.error('catalog fetch failed:', r.reason))
      const serviceDown = failed.some(
        (r) => !r.reason?.status || r.reason.status >= 500
      )
      if (serviceDown) setCatalogError(true)
      setCatalogLoaded(true)
    })
  }

  useEffect(() => {
    loadCatalog()
  }, [])

  function resetFilters () {
    setStartDate(defaultStartDate)
    setEndDate(defaultEndDate)
    setStartDepth(defaultStartDepth)
    setEndDepth(defaultEndDepth)
    setEovsSelected(
      eovsSelected.map((eov) => {
        return { ...eov, isSelected: false }
      })
    )
    setOrgsSelected(
      orgsSelected.map((org) => {
        return { ...org, isSelected: false }
      })
    )
    setDatasetsSelected(
      datasetsSelected.map((dataset) => {
        return { ...dataset, isSelected: false }
      })
    )
    setPlatformsSelected(
      platformsSelected.map((platform) => {
        return { ...platform, isSelected: false }
      })
    )
    setErddapServersSelected(
      erddapServersSelected.map((server) => {
        return { ...server, isSelected: false }
      })
    )
    setObisNodesSelected(
      obisNodesSelected.map((node) => {
        return { ...node, isSelected: false }
      })
    )
    setScientificNamesSelected([])
  }

  // Human label for a single multi-select option, matching how
  // MultiCheckboxFilter renders it (translated title where available).
  const optionLabel = (option, translatable) => {
    let title = option.title
    if (translatable) {
      if (
        option.titleTranslated &&
        option.titleTranslated[i18n.languages[0]] &&
        option.titleTranslated[i18n.languages[1]]
      ) {
        title = option.titleTranslated[i18n.language]
      } else if (t(option.title)) {
        title = t(option.title)
      }
    }
    return capitalizeFirstLetter(title)
  }

  // Build the active-filter descriptor for one multi-select filter: the list
  // of chosen options (each removable on its own) plus a clear-all handler.
  const buildMultiActiveFilter = (
    key,
    label,
    selected,
    setSelected,
    translatable
  ) => {
    const chosen = selected.filter((o) => o.isSelected)
    if (chosen.length === 0) return false
    return {
      key,
      label,
      removeAll: () => setAllOptionsIsSelectedTo(false, selected, setSelected),
      items: chosen.map((o) => ({
        id: o.pk,
        label: optionLabel(o, translatable),
        remove: () =>
          setSelected(
            selected.map((opt) =>
              opt.pk === o.pk ? { ...opt, isSelected: false } : opt
            )
          )
      }))
    }
  }

  // Filters currently constraining the map — surfaced as chips/bullets that
  // show what's applied. Each can be dropped whole, or value-by-value,
  // without opening the filters UI. Range labels (time/depth) are appended by
  // the consumer since they depend on presentation helpers.
  const buildActiveFilters = ({ timeframesBadgeTitle, depthRangeBadgeTitle }) =>
    [
      buildMultiActiveFilter(
        'eovs',
        t('oceanVariablesFiltername'),
        eovsSelected,
        setEovsSelected,
        true
      ),
      buildMultiActiveFilter(
        'platforms',
        t('platformsFilterName'),
        platformsSelected,
        setPlatformsSelected,
        true
      ),
      buildMultiActiveFilter(
        'orgs',
        t('organizationFilterName'),
        orgsSelected,
        setOrgsSelected,
        false
      ),
      buildMultiActiveFilter(
        'datasets',
        t('datasetsFilterName'),
        datasetsSelected,
        setDatasetsSelected,
        true
      ),
      (() => {
        // ERDDAP servers and OBIS nodes share a single "Data Portal" filter, so
        // they surface as one combined chip. Each chosen option is tagged with
        // its source array to avoid cross-deselecting on colliding pk values.
        const chosen = [
          ...erddapServersSelected
            .filter((o) => o.isSelected)
            .map((o) => ({
              o,
              src: 'erddap',
              all: erddapServersSelected,
              setSelected: setErddapServersSelected
            })),
          ...obisNodesSelected
            .filter((o) => o.isSelected)
            .map((o) => ({
              o,
              src: 'obis',
              all: obisNodesSelected,
              setSelected: setObisNodesSelected
            }))
        ]
        if (chosen.length === 0) return false
        return {
          key: 'sources',
          label: t('sourceFilterName'),
          removeAll: () => {
            setAllOptionsIsSelectedTo(
              false,
              erddapServersSelected,
              setErddapServersSelected
            )
            setAllOptionsIsSelectedTo(
              false,
              obisNodesSelected,
              setObisNodesSelected
            )
          },
          items: chosen.map(({ o, src, all, setSelected }) => ({
            id: `${src}-${o.pk}`,
            label: optionLabel(o, false),
            remove: () =>
              setSelected(
                all.map((opt) =>
                  opt.pk === o.pk ? { ...opt, isSelected: false } : opt
                )
              )
          }))
        }
      })(),
      timeFilterActive && {
        key: 'time',
        label: t('timeframeFilterName'),
        removeAll: () => {
          setStartDate(defaultStartDate)
          setEndDate(defaultEndDate)
        },
        items: [
          {
            id: 'time',
            label: timeframesBadgeTitle,
            remove: () => {
              setStartDate(defaultStartDate)
              setEndDate(defaultEndDate)
            }
          }
        ]
      },
      depthFilterActive && {
        key: 'depth',
        label: t('depthRangeFilterName'),
        removeAll: () => {
          setStartDepth(defaultStartDepth)
          setEndDepth(defaultEndDepth)
        },
        items: [
          {
            id: 'depth',
            label: depthRangeBadgeTitle,
            remove: () => {
              setStartDepth(defaultStartDepth)
              setEndDepth(defaultEndDepth)
            }
          }
        ]
      },
      scientificNamesSelected.length > 0 && {
        key: 'scientificName',
        label: t('scientificNameFilterName'),
        removeAll: () => setScientificNamesSelected([]),
        items: scientificNamesSelected.map((name) => ({
          id: name,
          label: name,
          remove: () =>
            setScientificNamesSelected(
              scientificNamesSelected.filter((n) => n !== name)
            )
        }))
      }
    ].filter(Boolean)

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
    timeFilterActive,
    timeExtent,
    depthFilterActive,
    anyServersSelected,
    anyObisNodesSelected,
    allObisNodesSelected,
    showObis,
    obisDataAvailable,
    totalNumberOfDatasets,
    resetFilters,
    buildActiveFilters,
    catalogError,
    catalogLoaded,
    loadCatalog
  }

  return (
    <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
  )
}
