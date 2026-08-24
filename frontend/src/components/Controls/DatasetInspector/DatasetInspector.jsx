import React, { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import { Funnel, FunnelFill } from 'react-bootstrap-icons'
import DataTable from 'react-data-table-component'
import TableFilter, { filterRows } from '../../ui/TableFilter.jsx'

// import platformColors from '../../platformColors'
import Loading from '../Loading/Loading.jsx'
import GriddapDetails from '../GriddapDetails/GriddapDetails.jsx'
import { server } from '../../../config'
import reportError from '../../../state/reportError.js'
import { splitLines } from '../../../utilities'
import { gridNodeFactors, totalGridNodes } from '../../../wmsUtilities'
import FilterButton from '../Filter/FilterButton/FilterButton.jsx'
import ZoomToDataset, {
  useZoomToDataset
} from '../../AppShell/ZoomToDataset/ZoomToDataset.jsx'
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

// Which CF discrete-sampling role identifies one record of this dataset, and
// which of its variables carries that role. The record list hands every kind
// back under the one `profile_id` key (shapeQuery.js coalesces profile_id /
// timeseries_id, and aliases a trajectory's trajectory_id into the same slot),
// so the column can only be named from the dataset's own cf_role variables.
// The order below follows that coalesce, with a trajectory's own role first
// when the dataset is one. Datasets that declare no role at all (OBIS, a
// tabledap table with no cf_role attribute anywhere) fall back to the generic
// "Record ID".
const CF_ROLE_LABELS = {
  timeseries_id: 'cfRoleTimeseriesIdText',
  profile_id: 'cfRoleProfileIdText',
  trajectory_id: 'cfRoleTrajectoryIdText'
}

function cfRoleColumn(dataset, roleOrder, t) {
  const variableFor = {
    timeseries_id: dataset.timeseries_id_variable,
    profile_id: dataset.profile_id_variable,
    trajectory_id: dataset.trajectory_id_variable
  }
  // '' is the harvester's sentinel for "this dataset has no such role"
  // (cf_role attributes are parsed as strings), and NULL means the same thing
  // once it has been through the database.
  const role = roleOrder.find((r) => variableFor[r])
  return {
    label: role ? t(CF_ROLE_LABELS[role]) : t('datasetInspectorRecordIDText'),
    variable: role ? variableFor[role] : undefined
  }
}

// A table heading that names the role on top and the variable behind it
// underneath, so the column says both what the ID means and where it came from.
function ColumnHeading({ label, variable }) {
  return (
    <span className='columnHeading'>
      <span className='columnHeadingLabel'>{label}</span>
      {variable && <span className='columnHeadingVariable'>{variable}</span>}
    </span>
  )
}

export default function DatasetInspector({
  dataset,
  // Shared with the sidebar header's back control (SelectionProvider), so both
  // ways out of this page do the same thing.
  returnToList,
  setHoveredDataset,
  setInspectRecordID,
  filterSet,
  query,
  selectedTrajectory,
  setSelectedTrajectory,
  activeWmsOverlay,
  setActiveWmsOverlay
}) {
  const { t } = useTranslation()
  const { zoomToDataset } = useZoomToDataset()
  const [datasetRecords, setDatasetRecords] = useState()
  const [recordFilterText, setRecordFilterText] = useState('')
  const [trajectoryPlatforms, setTrajectoryPlatforms] = useState()
  const [platformFilterText, setPlatformFilterText] = useState('')
  // Mirrors the platform table's rows-per-page so the page holding a
  // map-picked platform is computed against the size the user is actually on.
  const [platformRowsPerPage, setPlatformRowsPerPage] = useState(100)
  const inspectorRef = useRef(null)
  const isGrid = dataset.cdm_data_type === 'Grid'
  // no per-record list for OBIS (external) or griddap (metadata-only)
  const hasRecordList = dataset.source_type !== 'obis' && !isGrid
  // OBIS datasets always link out to OBIS; the rest have whichever of their
  // ERDDAP / CKAN URLs the harvest found.
  const hasSources =
    dataset.source_type === 'obis' ||
    Boolean(dataset.erddap_url || dataset.ckan_url)
  // Start loading rather than false: the fetch below is fired from an effect,
  // so an initial false would paint one frame of an empty record table before
  // the spinner appears.
  const [loading, setLoading] = useState(hasRecordList)

  // const platformColor = platformColors.filter(
  //   (pc) => pc.platform === dataset.platform
  // )
  const isTrajectoryDataset =
    dataset.source_type !== 'obis' &&
    (dataset.cdm_data_type || '').includes('Trajectory')

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
        reportError('datasetRecordsList fetch failed', error)
        if (!cancelled) setDatasetRecords([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dataset])

  // Trajectory datasets: list the platforms (trajectory ids) so one can be
  // picked to draw its full track on the map.
  useEffect(() => {
    if (!isTrajectoryDataset) {
      setTrajectoryPlatforms()
      return
    }
    fetch(`${server}/trajectories/platforms?datasetPKs=${dataset.pk}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((platforms) => setTrajectoryPlatforms(platforms))
      .catch((error) => {
        reportError('trajectory platforms fetch failed', error)
        setTrajectoryPlatforms([])
      })
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
  }, [returnToList])

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
  }, [returnToList])

  const dataColumnWith = '105px'

  // Trajectory datasets list one row per mission, so their record column is the
  // trajectory role; every other type resolves to whichever of profile_id /
  // timeseries_id the dataset declares.
  const recordIdColumn = cfRoleColumn(
    dataset,
    isTrajectoryDataset
      ? ['trajectory_id', 'profile_id', 'timeseries_id']
      : ['profile_id', 'timeseries_id', 'trajectory_id'],
    t
  )

  const columns = [
    {
      name: <ColumnHeading {...recordIdColumn} />,
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

  const platformColumns = [
    {
      // Same value the record column carries, named the same way: the
      // cf_role=trajectory_id variable, or the plain "Platform ID" when the
      // dataset is a single unnamed trajectory with no such variable.
      name: (
        <ColumnHeading
          label={
            dataset.trajectory_id_variable
              ? t('cfRoleTrajectoryIdText')
              : t('trajectoryPlatformIdText')
          }
          variable={dataset.trajectory_id_variable || undefined}
        />
      ),
      selector: (row) => row.trajectory_id,
      sortable: true,
      wrap: true,
      width: '130px'
    },
    {
      name: splitLines(t('timeSelectorStartDate')),
      selector: (row) => row.time_min?.split('T')[0],
      sortable: true,
      wrap: true,
      width: dataColumnWith
    },
    {
      name: splitLines(t('timeSelectorEndDate')),
      selector: (row) => row.time_max?.split('T')[0],
      sortable: true,
      wrap: true,
      width: dataColumnWith
    },
    {
      name: splitLines(t('trajectoryPlatformFixesText')),
      selector: (row) => row.n_points,
      sortable: true,
      wrap: true,
      width: dataColumnWith
    }
  ]

  // A platform picked on the map (rather than from this table) can sit on any
  // page of it — turn to the page holding it, so the highlighted row is one the
  // user can actually see. Rows render in the order the API returned them, so a
  // row's index is its position in this list; a column sort the user applied
  // reorders them and can land the jump a page off, which paging fixes.
  // filterRows passes a null row list straight through, and this runs before the
  // platforms fetch resolves (and for datasets that never have any).
  const platformRows = filterRows(trajectoryPlatforms, platformFilterText) || []
  const selectedPlatformIndex =
    selectedTrajectory?.datasetPk === dataset.pk
      ? platformRows.findIndex(
        (row) => row.trajectory_id === selectedTrajectory.trajectoryId
      )
      : -1
  const selectedPlatformPage =
    selectedPlatformIndex < 0
      ? 1
      : Math.floor(selectedPlatformIndex / platformRowsPerPage) + 1

  const { eovFilter, platformFilter, orgFilter, datasetFilter } = filterSet

  // The title bar's filter button: narrow the map to this dataset alone, or
  // release it again. Same toggle the dataset's chip in the Filters panel does
  // (FilterButton), on the one dataset this page is about.
  const datasetIsFiltered = datasetFilter.datasetsSelected.some(
    (option) => option.pk === dataset.pk && option.isSelected
  )
  const toggleDatasetFilter = () =>
    datasetFilter.setDatasetsSelected(
      datasetFilter.datasetsSelected.map((option) =>
        option.pk === dataset.pk
          ? { ...option, isSelected: !option.isSelected }
          : option
      )
    )

  return (
    <div
      className='datasetInspector'
      ref={inspectorRef}
      onMouseEnter={() => setHoveredDataset(dataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      {/* The title bar is pinned: it names the page, so it stays put while the
          metadata sheet and record table scroll under it. Title on the left,
          the two actions that belong to the dataset on the right — a heading at
          the top of a page needs no "Title" label over it. Double-clicking the
          bar frames the map on this dataset, the same thing the zoom button
          does, for anyone who goes for the title first; the map is otherwise
          left where the user put it, since opening a page highlights the
          dataset among the others rather than travelling to it.
          The way back is the sidebar header's own back control (Sidebar.jsx),
          which replaces the datasets banner while this page is open — one
          control, in the one place that marks the panel as being on a dataset
          rather than the list. */}
      <div className='datasetTitleBlock' onDoubleClick={zoomToDataset}>
        {/* A heading, and only a heading. Filtering the map to this dataset
            used to be a click on the title itself, which no reader expects of
            a page's title — it is the button beside the zoom one now. */}
        <h2 className='datasetTitle'>{dataset.title}</h2>
        <div className='datasetTitleActions'>
          <button
            type='button'
            className={classNames('datasetTitleAction', {
              active: datasetIsFiltered
            })}
            onClick={toggleDatasetFilter}
            aria-pressed={datasetIsFiltered}
            title={t(
              datasetIsFiltered
                ? 'datasetFilterButtonRemove'
                : 'datasetFilterButtonApply'
            )}
          >
            {datasetIsFiltered ? (
              <FunnelFill size={15} aria-hidden='true' />
            ) : (
              <Funnel size={15} aria-hidden='true' />
            )}
          </button>
          {/* Frames the map on this dataset; vanishes once it already is. */}
          <ZoomToDataset />
        </div>
      </div>
      <div className='datasetInspectorBody'>
        {/* The front matter, as compact as it can be read: each field is a
            small eyebrow label with its value stacked under it, and the fields
            flow two-up across the sheet, the chip-carrying ones taking a full
            row of their own. No row rules — the whitespace separates them. */}
        <dl className='datasetMetaSheet'>
          <div className='metaCell metaCellWide'>
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
          <div className='metaCell metaCellWide'>
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
          <div className='metaCell'>
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
          {/* A grid spells its node count out as a product of its axes, which
              needs the full width; a plain record count shares its row. */}
          <div className={isGrid ? 'metaCell metaCellWide' : 'metaCell'}>
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
          {/* The outbound links used to be a labelled row each; they say what
              they are in their own text, so one "Sources" line holds them
              all. */}
          {hasSources && (
            <div className='metaCell metaCellWide'>
              <dt className='metadataLabel'>
                {t('datasetInspectorSourcesText')}
              </dt>
              <dd className='metadataValue metadataLinks'>
                {dataset.source_type === 'obis' ? (
                  <a
                    className='metadataLink'
                    href={`https://obis.org/dataset/${dataset.dataset_id}`}
                    target='_blank'
                    rel='noreferrer'
                  >
                    {t('datasetInspectorOBISURL')}
                  </a>
                ) : (
                  <>
                    {dataset.erddap_url && (
                      <a
                        className='metadataLink'
                        href={dataset.erddap_url}
                        target='_blank'
                        title={t('datasetInspectorERDDAPText')}
                        rel='noreferrer'
                      >
                        {t('datasetInspectorERDDAPURL')} (ERDDAP™)
                      </a>
                    )}
                    {dataset.ckan_url && (
                      <a
                        className='metadataLink'
                        href={dataset.ckan_url}
                        target='_blank'
                        title={t('datasetInspectorCKANText')}
                        rel='noreferrer'
                      >
                        {t('datasetInspectorCKANURL')} (CKAN)
                      </a>
                    )}
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
        {isGrid && (
          <GriddapDetails
            dataset={dataset}
            activeWmsOverlay={activeWmsOverlay}
            setActiveWmsOverlay={setActiveWmsOverlay}
          />
        )}
        {isTrajectoryDataset && trajectoryPlatforms?.length > 0 && (
          <div className='recordSection'>
            <div className='recordSectionHeader'>
              <strong>{t('trajectoryPlatformsTitle')}</strong>
              <span className='recordHint'>
                {t('trajectoryPlatformsClickText')}
              </span>
            </div>
            <div className='recordTableScroll'>
              <TableFilter
                value={platformFilterText}
                onChange={setPlatformFilterText}
                placeholder={t('trajectoryPlatformsSearchPlaceholder')}
              />
              <DataTable
                onRowClicked={(row) =>
                  setSelectedTrajectory &&
                  setSelectedTrajectory(
                    selectedTrajectory?.trajectoryId === row.trajectory_id
                      ? undefined // click the active row again to clear
                      : {
                        datasetPk: dataset.pk,
                        datasetTitle: dataset.title,
                        trajectoryId: row.trajectory_id
                      }
                  )
                }
                striped
                pointerOnHover
                conditionalRowStyles={[
                  {
                    when: (row) =>
                      selectedTrajectory?.datasetPk === dataset.pk &&
                      selectedTrajectory?.trajectoryId === row.trajectory_id,
                    style: { backgroundColor: '#d5c9ee' }
                  }
                ]}
                columns={platformColumns}
                data={platformRows}
                defaultSortField='trajectory_id'
                pagination
                paginationPerPage={platformRowsPerPage}
                paginationDefaultPage={selectedPlatformPage}
                onChangeRowsPerPage={setPlatformRowsPerPage}
                paginationRowsPerPageOptions={[100, 150, 200, 250]}
                paginationComponentOptions={{
                  rowsPerPageText: t('tableComponentRowsPerPage'),
                  rangeSeparatorText: t('tableComponentOf'),
                  selectAllRowsItem: false
                }}
                highlightOnHover
              />
            </div>
          </div>
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
