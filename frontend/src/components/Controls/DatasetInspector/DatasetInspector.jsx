import * as React from 'react'
import { CircleFill } from 'react-bootstrap-icons'
import { Container, Table, Col, Row } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import platformColors from '../../platformColors'
import './styles.css'

export default function DatasetInspector({ dataset, setHoveredDataset, setInspectRecordID }) {
  const { t } = useTranslation()
  const platformColor = platformColors.filter(pc => pc.platform === dataset.platform)
  return (
    <div className='datasetInspector'>
      <div className='datasetMetadata'>
        <h5>
          {t('datasetInspectorURLText')}
          {/* Dataset URLs */}
        </h5>
        <div>
          <ul style={{ listStyleType: 'none' }}>
            <li>
              <a
                href={dataset.ckan_url}
                target='_blank'
                title={dataset.ckan_url ? dataset.ckan_url : 'unavailable'} rel="noreferrer">
                {t('datasetInspectorCKANURL')} (CKAN)
              </a>
            </li>
            <li>
              <a
                href={dataset.erddap_url}
                target='_blank'
                title={dataset.erddap_url ? dataset.erddap_url : 'unavailable'} rel="noreferrer">
                {t('datasetInspectorERDDAPURL')} (ERDDAP)
              </a>
            </li>
          </ul>
        </div>
        {/* <hr /> */}
        <h5>
          {t('datasetInspectorOrganizationText')}
          {/* Organizations */}
        </h5>
        <div>
          {dataset.organizations.join(', ')}
        </div>
        {/* <hr /> */}
        <h5>
          {t('datasetInspectorOceanVariablesText')}
          {/* Ocean Variables */}
        </h5>
        <div>
          {dataset.eovs.map((eov, index) => ' ' + t(eov)).join(',')}
        </div>
        {/* <hr /> */}
        <h5>
          {t('datasetInspectorPlatformText')}
          {/* Platform */}
        </h5>
        <div>
          {t(dataset.platform)}
        </div>
        {/* <hr /> */}
        <h5>
          {/* Records ... records total, 1000 shown */}
          {t('datasetInspectorRecordsText')} ({dataset && dataset.profiles_count > 1000 ? `${dataset.profiles_count} ${t('datasetInspectorRecordsOverflowText')}` : dataset.profiles_count})
        </h5>
      </div>
      <div className='inspectorTable'>
        <Table striped bordered size="sm">
          <thead>
            <tr>
              <th>{t('datasetInspectorRecordIDText')}</th>
              <th>{t('datasetInspectorTimeframeText')}</th>
              <th>{t('datasetInspectorDepthRangeText')}</th>
            </tr>
          </thead>
          <tbody>
            {dataset.profiles.map((profile, index) => {
              return (
                <tr key={index} onClick={() => setInspectRecordID(profile.profile_id)}>
                  <td>{profile.profile_id}</td>
                  <td>{`${new Date(profile.time_min).toLocaleDateString()} - ${new Date(profile.time_max).toLocaleDateString()}`}</td>
                  <td>{`${profile.depth_min < Number.EPSILON ? 0 : profile.depth_min > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_min.toFixed(1)} - ${profile.depth_max < Number.EPSILON ? 0 : profile.depth_max > 15000 ? t('datasetInspectorDepthTooLargeWarningText') : profile.depth_max.toFixed(1)}`}</td>
                </tr>
              )
            })}
            {dataset.profiles_count > 1000 && (
              <tr key={1001}>
                <td>{`1000/${dataset.profiles_count} ${t('datasetInspectorRecordsShownText')}`}</td>
                <td />
                <td />
              </tr>
            )}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
