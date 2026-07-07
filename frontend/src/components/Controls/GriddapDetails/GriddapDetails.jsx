import React from 'react'
import { Form } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'

import { defaultElevation, getTimeDimension } from '../../../wmsUtilities'
import './styles.css'

// Griddap-specific section of the dataset inspector: grid structure, variable
// list, and (when the ERDDAP serves WMS) the show-on-map switch. Variable
// selection, time/depth sliders and the colorbar live in the floating
// WmsLegend card over the map.
export default function GriddapDetails({
  dataset,
  activeWmsOverlay,
  setActiveWmsOverlay
}) {
  const { t } = useTranslation()
  const dimensions = dataset.grid_dimensions || []
  const variables = dataset.grid_variables || []
  const overlayActive = activeWmsOverlay?.pk === dataset.pk
  const timeDimension = getTimeDimension(dimensions)

  function formatDimensionValue(value) {
    if (value === null || value === undefined) return '—'
    if (typeof value === 'number') {
      return Number.isInteger(value) ? value : value.toFixed(4)
    }
    // ISO time strings: keep them readable
    return String(value).replace('T', ' ').replace('+00:00', 'Z')
  }

  function variableLabel(variable) {
    return variable.long_name || variable.standard_name || variable.name
  }

  function showOverlay() {
    setActiveWmsOverlay({
      pk: dataset.pk,
      datasetId: dataset.dataset_id,
      title: dataset.title,
      wmsUrl: dataset.wms_url,
      erddapUrl: dataset.erddap_url,
      variable: variables[0],
      variables,
      time: timeDimension?.max,
      elevation: defaultElevation(dimensions),
      bbox: dataset.coverage_bbox_geojson,
      dimensions
    })
  }

  return (
    <div className='griddapDetails'>
      <div className='metadataGridItem'>
        <strong>{t('griddapDimensionsTitle')}</strong>
        <table className='griddapDimensionsTable'>
          <thead>
            <tr>
              <th>{t('griddapDimensionName')}</th>
              <th>{t('griddapDimensionNodes')}</th>
              <th>{t('griddapDimensionMin')}</th>
              <th>{t('griddapDimensionMax')}</th>
              <th>{t('griddapDimensionResolution')}</th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((dim) => (
              <tr key={dim.name}>
                <td>{dim.name}</td>
                <td>{dim.n_values?.toLocaleString()}</td>
                <td>{formatDimensionValue(dim.min)}</td>
                <td>{formatDimensionValue(dim.max)}</td>
                <td>{dim.spacing || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='metadataGridItem'>
        <strong>{t('griddapVariablesTitle')}</strong>
        <ul className='griddapVariablesList'>
          {variables.map((variable) => (
            <li key={variable.name}>
              {variableLabel(variable)}
              {variable.units ? ` (${variable.units})` : ''}
            </li>
          ))}
        </ul>
      </div>
      {dataset.wms_url ? (
        <div className='metadataGridItem griddapWmsControls'>
          <strong>{t('griddapMapPreviewTitle')}</strong>
          <Form.Check
            type='switch'
            id='griddapShowOnMapSwitch'
            label={t('griddapShowOnMapToggle')}
            checked={overlayActive}
            disabled={!variables.length}
            onChange={(event) =>
              event.target.checked ? showOverlay() : setActiveWmsOverlay()
            }
          />
        </div>
      ) : (
        <div className='metadataGridItem griddapNoWms'>
          {t('griddapNoWmsText')}
        </div>
      )}
    </div>
  )
}
