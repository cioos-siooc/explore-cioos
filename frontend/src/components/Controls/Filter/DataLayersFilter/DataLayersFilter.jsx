/* eslint-disable react/prop-types */

import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import {
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS
} from '../../../../state/dataLayers.js'
import { useMapState } from '../../../../state/map/MapStateProvider.jsx'
import './styles.css'

// Which families of data draw on the map, and — for trajectories — how they
// draw. This was a column of switches in the legend card; inside the filter
// menu it takes the same checkbox idiom as every other filter, because that is
// what it does: the selection gates the map tiles, the datasets list and the
// counts alike (see datasetInDataLayers).
//
// The two trajectory options are a display choice rather than a data choice, so
// they render indented under Trajectories and only while it is on. They are
// independent — either, both, or neither — and clearing the last one turns the
// parent off (see setTrajectoryViews in MapStateProvider).
export default function DataLayersFilter () {
  const { t } = useTranslation()
  const {
    dataLayers,
    toggleDataLayer,
    tracksMode,
    trajectoryHexes,
    toggleTrackLines,
    toggleTrajectoryHexes
  } = useMapState()

  function option (key, label, checked, onToggle, title) {
    return (
      <div
        key={key}
        className={`optionButton ${checked ? 'selected' : ''}`}
        title={title || label}
        onClick={onToggle}
      >
        {checked ? <CheckSquare /> : <Square />}
        <span className='optionName'>{label}</span>
      </div>
    )
  }

  return (
    <div className='multiCheckboxFilter dataLayersFilter'>
      {DATA_LAYER_KEYS.map((key) => (
        <React.Fragment key={key}>
          {option(
            key,
            t(DATA_LAYER_LABEL_KEYS[key]),
            Boolean(dataLayers[key]),
            () => toggleDataLayer(key)
          )}
          {key === 'trajectories' && dataLayers.trajectories && (
            <div className='dataLayerSubOptions'>
              {option(
                'tracksMode',
                t('layerTracksMode'),
                tracksMode,
                toggleTrackLines
              )}
              {option(
                'trajectoryHexes',
                t('layerTrajectoryHexes'),
                trajectoryHexes,
                toggleTrajectoryHexes
              )}
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
