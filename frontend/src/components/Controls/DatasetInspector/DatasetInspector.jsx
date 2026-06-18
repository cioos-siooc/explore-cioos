import React, { useState, useEffect, useRef } from 'react'
import { XLg } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import 'react-data-table-component-extensions/dist/index.css'

// import platformColors from '../../platformColors'
import Loading from '../Loading/Loading.jsx'
import { server } from '../../../config'
import { splitLines } from '../../../utilities'
import FilterButton from '../Filter/FilterButton/FilterButton.jsx'
import './styles.css'

export default function DatasetInspector({
  dataset,
  setInspectDataset,
  setBackClicked,
  setHoveredDataset,
  setInspectRecordID,
  filterSet,
  query
}) {
  const { t } = useTranslation()
  const [datasetRecords, setDatasetRecords] = useState()
  const [loading, setLoading] = useState(false)
  const inspectorRef = useRef(null)

  const returnToList = () => {
    setBackClicked(true)
    setInspectDataset()
  }
  // const platformColor = platformColors.filter(
  //   (pc) => pc.platform === dataset.platform
  // )

  useEffect(() => {
    if (dataset.source_type === 'obis') return
    setLoading(true)
    const queryParams = new URLSearchParams(query)
    queryParams.set('datasetPKs', dataset.pk)

    fetch(`${server}/datasetRecordsList?${queryParams.toString()}`)
      .then((response) => {
        if (response.ok) {
          response.json().then((data) => {
            setDatasetRecords(data)
            setLoading(false)
          })
        }
      })
      .catch((error) => {
        setLoading(false)
        throw error
      })
  }, [dataset])

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
  const data = datasetRecords?.profiles

  const tableData = {
    columns,
    data
  }

  const { eovFilter, platformFilter, orgFilter, datasetFilter } = filterSet

  return (
    <div className='datasetInspector' ref={inspectorRef}>
      <div
        className='datasetInspectorBody'
        onMouseEnter={() => setHoveredDataset(dataset)}
        onMouseLeave={() => setHoveredDataset()}
      >
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
        </div>
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
              {t('datasetInspectorRecordsText')}
            </dt>
            <dd className='metadataValue recordCount'>
              {dataset.profiles_count !== dataset.n_profiles
                ? `${dataset.profiles_count} / ${dataset.n_profiles}`
                : dataset.profiles_count}
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
        {dataset.source_type !== 'obis' && (
          <div className='recordSection'>
            <div className='recordSectionHeader'>
              <strong>{t('datasetInspectorRecordTable')}</strong>
              <span className='recordHint'>
                {t('datasetInspectorClickPreviewText')}
              </span>
            </div>
            {loading ? (
              <div className='datasetInspectorLoadingContainer'>
                <Loading />
              </div>
            ) : (
              <div className='recordTableScroll'>
                <DataTableExtensions
                  {...tableData}
                  print={false}
                  filterPlaceholder={t('datasetInspectorFilterText')}
                  export={false}
                >
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
                </DataTableExtensions>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
