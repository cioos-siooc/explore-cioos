import React, { useState, useEffect } from 'react'
import { ChevronCompactLeft, CircleFill } from 'react-bootstrap-icons'
import { Container, Table } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import DataTable from 'react-data-table-component'
import DataTableExtensions from 'react-data-table-component-extensions'
import 'react-data-table-component-extensions/dist/index.css'

import platformColors from '../../platformColors'
import Loading from '../Loading/Loading.jsx'
import { server } from '../../../config'
import { splitLines } from '../../../utilities'
import './styles.css'

export default function DatasetInspector({
  dataset,
  setInspectDataset,
  setHoveredDataset,
  setInspectRecordID,
  filterSet
}) {
  const { t } = useTranslation()
  const [datasetRecords, setDatasetRecords] = useState()
  const [loading, setLoading] = useState(false)
  const platformColor = platformColors.filter(
    (pc) => pc.platform === dataset.platform
  )

  useEffect(() => {
    setLoading(true)
    fetch(`${server}/datasetRecordsList?datasetPKs=${dataset.pk}`)
      .then((response) => {
        if (response.ok) {
          response.json().then((data) => {
            setDatasetRecords(data)
            setLoading(false)
          })
        }
      })
      .catch((error) => {
        console.log(error)
        setLoading(false)
      })
  }, [])

  const { eovFilter, platformFilter, orgFilter, datasetFilter } = filterSet
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

  return (
    <div
      className='datasetInspector'
      onMouseEnter={() => setHoveredDataset(dataset)}
      onMouseLeave={() => setHoveredDataset()}
    >
      <div
        className='backButton'
        onClick={() => setInspectDataset()}
        title={t('datasetInspectorBackButtonTitle')} // 'Return to dataset list'
      >
        <ChevronCompactLeft />
        {t('datasetInspectorBackButtonText')}
        {/* Back */}
      </div>
      <div>
        <div className='metadataAndRecordIDTableGridContainer'>
          <strong>{t('datasetInspectorTitleText')}</strong>
          {/* {t(dataset.title)} */}
          <button
            onClick={() => alert(`setting dataset filter to ${dataset.title}`)}
          >
            {dataset.title}
          </button>
          <div className='metadataGridContainer'>
            <div className='metadataGridItem organisation'>
              <strong>{t('datasetInspectorOrganizationText')}</strong>
              {/* {t(dataset.title)} */}
              <button onClick={() => datasetFilter.setDatasetsSelected([...datasetFilter.datasetsSelected, { ...dataset, isSelected: true }])}>
                {dataset.title}
              </button>
              <h5>{t('datasetInspectorOrganizationText')}</h5>
              {dataset.organizations.map((org, index) => {
                console.log(dataset, org, orgFilter)
                return <button key={index}
                  onClick={() => orgFilter.setOrgsSelected([...orgFilter.orgsSelected, { ...orgFilter.orgsSelected.filter(orgA => orgA.title === org), isSelected: true }])}
                >{t(org)}</button>
              })}
            </div>
            <div className='metadataGridItem variable'>
              <strong>{t('datasetInspectorOceanVariablesText')}</strong>
              {dataset.eovs.map((eov, index) => {
                return (
                  <button
                    key={index}
                    onClick={() => alert(`setting EOV filter to ${eov}`)}
                  >
                    {t(eov)}
                  </button>
                )
              })}
            </div>
            <div className='metadataGridItem platform'>
              <strong>{t('datasetInspectorPlatformText')}</strong>
              <button
                onClick={() =>
                  alert(`setting platform filter to ${dataset.platform}`)
                }
              >
                {t(dataset.platform)}
              </button>
            </div>
            <div className='metadataGridItem records'>
              <strong>{t('datasetInspectorRecordsText')}</strong>(
              {dataset && `${dataset.profiles_count} / ${dataset.n_profiles}`})
            </div>
            <div className='metadataGridItem ERDAP'>
              <strong>Dataset source URL</strong>
              {dataset.erddap_url && (
                <a
                  className={dataset.erddap_url ? undefined : 'unavailable'}
                  href={dataset.erddap_url}
                  target='_blank'
                  title={
                    dataset.erddap_url ? dataset.erddap_url : 'unavailable'
                  }
                  rel='noreferrer'
                >
                  {t('datasetInspectorERDDAPURL')} (ERDDAP)
                </a>
              )}
            </div>
            <div className='metadataGridItem CKAN'>
              <strong>Catalogue URL</strong>
              {dataset.ckan_url && (
                <a
                  className={!dataset.ckan_url && 'unavailable'}
                  href={dataset.ckan_url}
                  target='_blank'
                  title={dataset.ckan_url ? dataset.ckan_url : 'unavailable'}
                  rel='noreferrer'
                >
                  {t('datasetInspectorCKANURL')} (CKAN)
                </a>
              )}
            </div>
          </div>
          <div className='metadataGridItem recordTable'>
            <strong>{t('datasetInspectorRecordTable')}</strong>
          </div>
          {loading ? (
            <div className='datasetInspectorLoadingContainer'>
              <Loading />
            </div>
          ) : (
            <div className='main'>
              <div>{t('datasetInspectorClickPreviewText')}</div>
              <DataTableExtensions
                {...tableData}
                print={false}
                exportHeaders
                highlightOnHover={false}
                filterPlaceholder={t('datasetInspectorFilterText')}
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
                  highlightOnHover
                />
              </DataTableExtensions>
            </div>
          )}
        </div >
      </div >
    </div >
  )
}
