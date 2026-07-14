import React, { useState, useEffect, useRef } from 'react'
import { XLg } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import DataTable from 'react-data-table-component'
import TableFilter, { filterRows } from '../../ui/TableFilter.jsx'

// import platformColors from '../../platformColors'
import Loading from '../Loading/Loading.jsx'
import GriddapDetails from '../GriddapDetails/GriddapDetails.jsx'
import { server } from '../../../config'
import { splitLines } from '../../../utilities'
import { gridNodeFactors, totalGridNodes } from '../../../wmsUtilities'
import FilterButton from '../Filter/FilterButton/FilterButton.jsx'
import ZoomToDataset from '../../AppShell/ZoomToDataset/ZoomToDataset.jsx'
import './styles.css'

// The grid's node count spelled out as the product of its axes —
// longitude × latitude × time × depth = total — so the number is traceable to
// the grid's shape rather than dropped on the reader as a bare total.
function GridNodeCount({ dimensions }) {
  const factors = gridNodeFactors(dimensions)
  const total = totalGridNodes(dimensions)
  if (!factors.length) return total?.toLocaleString() ?? null

  return (
    <span className='gridNodeCount'>
      <span className='gridNodeFactors'>
        {factors.map((dim, index) => (
          <React.Fragment key={dim.name}>
            {index > 0 && <span className='gridNodeOperator'>×</span>}
            <span className='gridNodeFactor' title={dim.name}>
              <span className='gridNodeFactorValue'>
                {dim.n_values.toLocaleString()}
              </span>
              <span className='gridNodeFactorName'>{dim.name}</span>
            </span>
          </React.Fragment>
        ))}
      </span>
      <span className='gridNodeTotal'>= {total?.toLocaleString()}</span>
    </span>
  )
}

export default function DatasetInspector({
  dataset,
  setInspectDataset,
  setBackClicked,
  setHoveredDataset,
  setInspectRecordID,
  filterSet,
  query,
  activeWmsOverlay,
  setActiveWmsOverlay
}) {
  const { t } = useTranslation()
  const [datasetRecords, setDatasetRecords] = useState()
  const [recordFilterText, setRecordFilterText] = useState('')
  const inspectorRef = useRef(null)
  const isGrid = dataset.cdm_data_type === 'Grid'
  // no per-record list for OBIS (external) or griddap (metadata-only)
  const hasRecordList = dataset.source_type !== 'obis' && !isGrid
  // Start loading rather than false: the fetch below is fired from an effect,
  // so an initial false would paint one frame of an empty record table before
  // the spinner appears.
  const [loading, setLoading] = useState(hasRecordList)

  const returnToList = () => {
    setBackClicked(true)
    setInspectDataset()
  }
  // const platformColor = platformColors.filter(
  //   (pc) => pc.platform === dataset.platform
  // )

  useEffect(() => {
    if (!hasRecordList) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const queryParams = new URLSearchParams(query)
    queryParams.set('datasetPKs', dataset.pk)

    fetch(`${server}/datasetRecordsList?${queryParams.toString()}`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`datasetRecordsList failed: ${response.status}`)
        }
        return response.json()
      })
      .then((data) => {
        if (!cancelled) setDatasetRecords(data)
      })
      .catch((error) => {
        // An error response used to leave the spinner running forever. Land on
        // an empty record table instead — the rest of the page still reads.
        console.error('datasetRecordsList failed:', error)
        if (!cancelled) setDatasetRecords([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dataset])

  // Browser Back needs no handling here: the open dataset lives in the URL
  // (?dataset=…&server=…, owned by SelectionProvider), so popping that history
  // entry closes the page through the router.

  // Backspace backs out to the list, unless the cursor is in a field —
  // there it still means "delete a character" (e.g. the record filter box).
  useEffect(() => {
    const typingIn = (target) =>
      target instanceof Element &&
      (target.isContentEditable ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

    const onKeyDown = (e) => {
      if (e.key !== 'Backspace' || typingIn(e.target)) return
      e.preventDefault()
      returnToList()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Swipe left (touch, trackpad two-finger, or mouse horizontal wheel) to
  // return to the dataset list. Swipes work everywhere, including over the
  // record table: while the table still has room to scroll left the gesture
  // scrolls the table, and only once it's at its left edge (or doesn't
  // overflow) does the same swipe pop back to the list.
  useEffect(() => {
    const el = inspectorRef.current
    if (!el) return undefined

    const SWIPE_THRESHOLD = 70 // px of leftward travel to count as a swipe
    const tableUnder = (target) =>
      target instanceof Element ? target.closest('.recordTableScroll') : null
    // The table can still absorb a leftward gesture if it overflows
    // horizontally and isn't yet scrolled to its left edge.
    const tableCanScrollLeft = (table) =>
      table &&
      table.scrollWidth - table.clientWidth > 1 &&
      table.scrollLeft > 0

    let touchStartX = 0
    let touchStartY = 0
    let startTable = null

    const onTouchStart = (e) => {
      startTable = tableUnder(e.target)
      touchStartX = e.touches[0].clientX
      touchStartY = e.touches[0].clientY
    }
    const onTouchEnd = (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX
      const dy = e.changedTouches[0].clientY - touchStartY
      if (dx > -SWIPE_THRESHOLD || Math.abs(dx) <= Math.abs(dy)) return
      if (tableCanScrollLeft(startTable)) return
      returnToList()
    }

    let wheelAccumX = 0
    let wheelTimer = null
    const onWheel = (e) => {
      // Only react to predominantly-horizontal gestures.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
      // Let the table consume leftward scroll until it bottoms out at its
      // left edge; reset the back accumulator while it's still scrolling.
      if (e.deltaX < 0 && tableCanScrollLeft(tableUnder(e.target))) {
        wheelAccumX = 0
        return
      }
      wheelAccumX += e.deltaX
      if (wheelTimer) clearTimeout(wheelTimer)
      wheelTimer = setTimeout(() => {
        wheelAccumX = 0
      }, 150)
      if (wheelAccumX <= -SWIPE_THRESHOLD) {
        wheelAccumX = 0
        returnToList()
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      if (wheelTimer) clearTimeout(wheelTimer)
    }
  }, [])

  const dataColumnWith = '105px'

  const columns = [
    {
      name: splitLines(t('datasetInspectorRecordIDText')),
      selector: (row) => row.profile_id,
      sortable: true,
      wrap: true,
      width: '130px'
    },
    {
      name: splitLines(t('timeSelectorStartDate')),
      selector: (row) => row.time_min,
      sortable: true,
      wrap: true,
      width: dataColumnWith
    },
    {
      name: splitLines(t('timeSelectorEndDate')),
      selector: (row) => row.time_max,
      sortable: true,
      wrap: true,
      width: dataColumnWith
    },
    {
      name: splitLines(t('depthFilterStartDepth')),
      selector: (row) => row.depth_min,
      sortable: true,
      wrap: true,
      width: dataColumnWith
    },
    {
      name: splitLines(t('depthFilterEndDepth')),
      selector: (row) => row.depth_max,
      sortable: true,
      wrap: true,
      width: dataColumnWith
    }
  ]
  const data = filterRows(datasetRecords?.profiles, recordFilterText)

  const { eovFilter, platformFilter, orgFilter, datasetFilter } = filterSet

  return (
    <div
      className='datasetInspector'
      ref={inspectorRef}
      onMouseEnter={() => setHoveredDataset(dataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {/* The title block is pinned: it names the page, so it stays put while
          the metadata sheet and record table scroll under it. */}
      <div className='datasetTitleBlock'>
        <div className='datasetTitleTop'>
          <span className='metadataLabel'>
            {t('datasetInspectorTitleText')}
          </span>
          <button
            type='button'
            className='closeButton'
            onClick={returnToList}
            title={t('datasetInspectorBackButtonTitle')} // 'Return to dataset list'
            aria-label={t('datasetInspectorBackButtonTitle')}
          >
            <XLg />
          </button>
        </div>
        <FilterButton
          setOptionsSelected={datasetFilter.setDatasetsSelected}
          optionsSelected={datasetFilter.datasetsSelected}
          option={dataset}
        />
        {/* Same action as the pill floating over the map, and it vanishes the
            same way once the map is already framed on this dataset. */}
        <ZoomToDataset variant='inline' />
      </div>
      <div className='datasetInspectorBody'>
        <dl className='datasetMetaSheet'>
          <div className='metaRow'>
            <dt className='metadataLabel'>
              {t('datasetInspectorOrganizationText')}
            </dt>
            <dd className='metadataValue'>
              {dataset.organizations.map((org, index) => {
                return (
                  <FilterButton
                    key={index}
                    setOptionsSelected={orgFilter.setOrgsSelected}
                    optionsSelected={orgFilter.orgsSelected}
                    option={
                      orgFilter.orgsSelected.filter((o) => org === o.title)[0]
                    }
                  />
                )
              })}
            </dd>
          </div>
          <div className='metaRow'>
            <dt className='metadataLabel'>
              {t('datasetInspectorOceanVariablesText')}
            </dt>
            <dd className='metadataValue'>
              {dataset.eovs.map((eov, index) => {
                return (
                  <FilterButton
                    key={index}
                    setOptionsSelected={eovFilter.setEovsSelected}
                    optionsSelected={eovFilter.eovsSelected}
                    option={
                      eovFilter.eovsSelected.filter((e) => eov === e.title)[0]
                    }
                  />
                )
              })}
            </dd>
          </div>
          <div className='metaRow'>
            <dt className='metadataLabel'>
              {t('datasetInspectorPlatformText')}
            </dt>
            <dd className='metadataValue'>
              <FilterButton
                setOptionsSelected={platformFilter.setPlatformsSelected}
                optionsSelected={platformFilter.platformsSelected}
                option={
                  platformFilter.platformsSelected.filter(
                    (p) => dataset.platform === p.title
                  )[0]
                }
              />
            </dd>
          </div>
          <div className='metaRow'>
            <dt className='metadataLabel'>
              {isGrid ? t('griddapNodesText') : t('datasetInspectorRecordsText')}
            </dt>
            <dd className='metadataValue recordCount'>
              {isGrid ? (
                <GridNodeCount dimensions={dataset.grid_dimensions} />
              ) : dataset.profiles_count !== dataset.n_profiles ? (
                `${dataset.profiles_count} / ${dataset.n_profiles}`
              ) : (
                dataset.profiles_count
              )}
            </dd>
          </div>
          {dataset.source_type === 'obis' ? (
            <div className='metaRow'>
              <dt className='metadataLabel'>OBIS</dt>
              <dd className='metadataValue'>
                <a
                  className='metadataLink'
                  href={`https://obis.org/dataset/${dataset.dataset_id}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  {t('datasetInspectorOBISURL')}
                </a>
              </dd>
            </div>
          ) : (
            <>
              {dataset.erddap_url && (
                <div className='metaRow'>
                  <dt className='metadataLabel'>
                    {t('datasetInspectorERDDAPText')}
                  </dt>
                  <dd className='metadataValue'>
                    <a
                      className='metadataLink'
                      href={dataset.erddap_url}
                      target='_blank'
                      title={dataset.erddap_url}
                      rel='noreferrer'
                    >
                      {t('datasetInspectorERDDAPURL')} (ERDDAP™)
                    </a>
                  </dd>
                </div>
              )}
              {dataset.ckan_url && (
                <div className='metaRow'>
                  <dt className='metadataLabel'>
                    {t('datasetInspectorCKANText')}
                  </dt>
                  <dd className='metadataValue'>
                    <a
                      className='metadataLink'
                      href={dataset.ckan_url}
                      target='_blank'
                      title={dataset.ckan_url}
                      rel='noreferrer'
                    >
                      {t('datasetInspectorCKANURL')} (CKAN)
                    </a>
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        {isGrid && (
          <GriddapDetails
            dataset={dataset}
            activeWmsOverlay={activeWmsOverlay}
            setActiveWmsOverlay={setActiveWmsOverlay}
          />
        )}
        {hasRecordList && (
          <div className='recordSection'>
            <div className='recordSectionHeader'>
              <strong>{t('datasetInspectorRecordTable')}</strong>
              <span className='recordHint'>
                {t('datasetInspectorClickPreviewText')}
              </span>
            </div>
            {loading ? (
              <div className='datasetInspectorLoadingContainer'>
                <Loading variant='inline' />
              </div>
            ) : (
              <div className='recordTableScroll'>
                <TableFilter
                  value={recordFilterText}
                  onChange={setRecordFilterText}
                  placeholder={t('datasetInspectorFilterText')}
                />
                <DataTable
                  onRowClicked={(row) => setInspectRecordID(row.profile_id)}
                  striped
                  pointerOnHover
                  columns={columns}
                  data={data}
                  defaultSortField='profile_id'
                  defaultSortAsc={false}
                  pagination
                  paginationPerPage={100}
                  paginationRowsPerPageOptions={[100, 150, 200, 250]}
                  paginationComponentOptions={{
                    rowsPerPageText: t('tableComponentRowsPerPage'),
                    rangeSeparatorText: t('tableComponentOf'),
                    selectAllRowsItem: false
                  }}
                  highlightOnHover
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
