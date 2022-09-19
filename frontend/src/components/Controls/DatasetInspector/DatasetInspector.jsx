import React, { useState, useEffect } from 'react'
import { ChevronCompactLeft, CircleFill } from 'react-bootstrap-icons'
import { Container, Table } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import platformColors from '../../platformColors'
import Loading from '../Loading/Loading.jsx'
import { server } from '../../../config'
import './styles.css'

export default function DatasetInspector({ dataset, setInspectDataset, setHoveredDataset, setInspectRecordID }) {
  const { t } = useTranslation()
  const [datasetRecords, setDatasetRecords] = useState()
  const [loading, setLoading] = useState(false)
  const platformColor = platformColors.filter(pc => pc.platform === dataset.platform)

  useEffect(() => {
    setLoading(true)
    fetch(`${server}/datasetRecordsList?datasetPKs=${dataset.pk}`).then(response => {
      if (response.ok) {
        response.json().then(data => {
          setDatasetRecords(data)
          setLoading(false)
        })
      }
    }).catch(error => {
      console.log(error)
      setLoading(false)
    })
  }, [])

  return (
    <div className='datasetInspector'
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
        <div className="previewFlexItem metadataAndRecordIDTableGridContainer">
          <div className="metadataGridContainer">
            <div className="metadataGridItem organisation">
              <h5>{t('datasetInspectorTitleText')}</h5>
              {/* {t(dataset.title)} */}
              <button onClick={() => console.log('setting dataset filter to ', dataset.title)}>
                {dataset.title}
              </button>
              <h5>{t('datasetInspectorOrganizationText')}</h5>
              {dataset.organizations.map((org, index) => {
                return <button key={index} onClick={() => console.log('setting org filter to ', org)}>{t(org)}</button>
              })}
            </div>
            <div className="metadataGridItem variable">
              <h5>{t('datasetInspectorOceanVariablesText')}</h5>
              {dataset.eovs.map((eov, index) => {
                return <button key={index} onClick={() => console.log('setting EOV filter to', eov)}>{t(eov)}</button>
              })}
            </div>
            <div className="metadataGridItem platform">
              <h5>{t('datasetInspectorPlatformText')}</h5>
              <button
                onClick={() => console.log('setting platform filter to ', dataset.platform)}
              >
                {t(dataset.platform)}
              </button>
            </div>
            <div className="metadataGridItem records">
              <h5>{t('datasetInspectorRecordsText')}</h5>
              ({dataset && `${dataset.profiles_count} / ${dataset.n_profiles}`})
              {/* <button
                onClick={() => alert('selected all records from dataset')}
                disabled={dataset.profiles_count === dataset.n_profiles}
                title={t('datasetInspectorRecordsSelectAllButtonText')}
              >
                Select All
              </button> */}
            </div>
            <div className="metadataGridItem button ERDAP">
              <a
                href={dataset.erddap_url}
                target='_blank'
                title={dataset.erddap_url ? dataset.erddap_url : 'unavailable'} rel="noreferrer">
                {t('datasetInspectorERDDAPURL')} (ERDDAP)
              </a>
            </div>
            <div className="metadataGridItem button CKAN">
              <a
                href={dataset.ckan_url}
                target='_blank'
                title={dataset.ckan_url ? dataset.ckan_url : 'unavailable'} rel="noreferrer">
                {t('datasetInspectorCKANURL')} (CKAN)
              </a>
            </div>
          </div>
          {loading
            ? <div className='datasetInspectorLoadingContainer'>
              <Loading />
            </div>
            : <Table className='inspectorTable' striped bordered size="sm">
              <thead>
                <tr>
                  <th>{t('datasetInspectorRecordIDText')}</th>
                  <th>{t('datasetInspectorTimeframeText')}</th>
                  <th>{t('datasetInspectorDepthRangeText')}</th>
                </tr>
              </thead>
              <tbody>
                {datasetRecords && datasetRecords.profiles.map((profile, index) => {
                  return (
                    <tr key={index} onClick={() => setInspectRecordID(profile.profile_id)}>
                      <td>{profile.profile_id}</td>
                      <td>{`${new Date(profile.time_min).toLocaleDateString()} - ${new Date(profile.time_max).toLocaleDateString()}`}</td>
                      <td>{`${profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_min.toFixed(1)} - ${profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_max.toFixed(1)}`}</td>
                    </tr>
                  )
                })}
                {datasetRecords && datasetRecords.profiles_count > 1000 && (
                  <tr key={1001}>
                    <td>{`1000/${datasetRecords.profiles_count} ${t('datasetInspectorRecordsShownText')}`}</td>
                    <td />
                    <td />
                  </tr>
                )}
              </tbody>
            </Table>
          }
        </div >
      </div >
    </div>
  )
}
