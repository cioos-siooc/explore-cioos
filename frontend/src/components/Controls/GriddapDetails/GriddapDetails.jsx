import React, { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Switch from '../../ui/Switch.jsx'

import { buildWmsOverlay } from '../../../wmsUtilities'
import { useFilters } from '../../../state/filters/FilterProvider.jsx'
import { useUI } from '../../../state/ui/UIProvider.jsx'
import WmsLegend from '../WmsLegend/WmsLegend.jsx'
import './styles.css'

// Griddap-specific section of the dataset inspector: grid structure, variable
// list, and (when the ERDDAP serves WMS) the show-on-map switch. While the
// dataset page is open the WmsLegend (variable picker, colorbar) renders inline
// here; when the sidebar is collapsed it moves to the floating card over the
// map (rendered by AppShell). Which slice of the grid is drawn is set on the
// bars along the bottom of the map, beside the filters for the same axes.
export default function GriddapDetails({
  dataset,
  activeWmsOverlay,
  setActiveWmsOverlay
}) {
  const { t } = useTranslation()
  const { eovsSelected } = useFilters()
  const { sidebarOpen } = useUI()
  const dimensions = dataset.grid_dimensions || []
  const variables = dataset.grid_variables || []
  const overlayActive = activeWmsOverlay?.pk === dataset.pk

  const selectedEovTitles = (eovsSelected || [])
    .filter((eov) => eov.isSelected)
    .map((eov) => eov.title)

  function showOverlay() {
    setActiveWmsOverlay(buildWmsOverlay(dataset, selectedEovTitles))
  }

  // Auto-show the WMS overlay when a griddap dataset with a WMS endpoint is
  // inspected. Deliberately keyed on the dataset pk alone: toggling the overlay
  // off must not immediately re-show it, so the effect only re-runs when a
  // different dataset is inspected.
  useEffect(() => {
    if (dataset.wms_url && variables.length) showOverlay()
  }, [dataset.pk])

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

  return (
    <div className='griddapDetails'>
      {dataset.wms_url ? (
        <div className='metadataGridItem griddapWmsControls'>
          <strong>{t('griddapMapPreviewTitle')}</strong>
          <Switch
            id='griddapShowOnMapSwitch'
            label={t('griddapShowOnMapToggle')}
            checked={overlayActive}
            disabled={!variables.length}
            onChange={(event) =>
              event.target.checked ? showOverlay() : setActiveWmsOverlay()
            }
          />
          {overlayActive && sidebarOpen && (
            <WmsLegend
              overlay={activeWmsOverlay}
              variant='inline'
              onClose={() => setActiveWmsOverlay()}
              setActiveWmsOverlay={setActiveWmsOverlay}
            />
          )}
        </div>
      ) : (
        <div className='metadataGridItem griddapNoWms'>
          {t('griddapNoWmsText')}
        </div>
      )}
      <div className='metadataGridItem'>
        <strong>{t('griddapDimensionsTitle')}</strong>
        {/* One card per axis rather than a 5-column table: at the sidebar's
            width the table's columns collapsed into unreadable slivers. */}
        <ul className='griddapDimensionsList'>
          {dimensions.map((dim) => (
            <li key={dim.name} className='griddapDimension'>
              <div className='griddapDimensionHead'>
                <span className='griddapDimensionName'>{dim.name}</span>
                <span className='griddapDimensionNodes'>
                  {dim.n_values?.toLocaleString()}{' '}
                  {t('griddapDimensionNodes').toLowerCase()}
                </span>
              </div>
              <div className='griddapDimensionRange'>
                <span className='griddapDimensionBound'>
                  {formatDimensionValue(dim.min)}
                </span>
                <span className='griddapDimensionArrow'>→</span>
                <span className='griddapDimensionBound'>
                  {formatDimensionValue(dim.max)}
                </span>
                {dim.units && (
                  <span className='griddapDimensionUnits'>{dim.units}</span>
                )}
              </div>
              {dim.spacing && (
                <div className='griddapDimensionSpacing'>
                  {t('griddapDimensionResolution')}: {dim.spacing}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className='metadataGridItem'>
        <strong>{t('griddapVariablesTitle')}</strong>
        <ul className='griddapVariablesList'>
          {variables.map((variable) => (
            <li key={variable.name} className='griddapVariable'>
              <div className='griddapVariableHead'>
                <span className='griddapVariableLabel'>
                  {variableLabel(variable)}
                </span>
                {variable.units && (
                  <span className='griddapVariableUnits'>
                    ({variable.units})
                  </span>
                )}
              </div>
              <code className='griddapVariableName'>{variable.name}</code>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
