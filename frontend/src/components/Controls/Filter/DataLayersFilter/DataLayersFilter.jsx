/* eslint-disable react/prop-types */

import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
  TRAJECTORY_LAYER_KEYS,
  anyTrajectoryLayerOn,
  isDataLayerChecked
} from '../../../../state/dataLayers.js'
import { useMapState } from '../../../../state/map/MapStateProvider.jsx'
import './styles.css'

// Which observation geometries the map draws, and — for the two path-sampling
// ones — how they draw. It behaves as every other filter does, down to the
// semantics and not just the idiom: no ticks means unfiltered (all six drawn),
// ticking narrows to what is ticked, and unticking the last one returns to all.
// The selection gates the map tiles, the datasets list and the counts alike
// (see datasetInDataLayers).
//
// Each row carries a hint line: what the geometry means in plain terms and the
// platforms that typically produce it. "TimeSeriesProfile" tells a data manager
// exactly what it is and a visitor nothing at all, and the hint is what closes
// that gap without renaming the CF types.
//
// The track/coverage view options belong to Trajectory and TrajectoryProfile
// jointly — one set of map layers fed by both — so they render once, after the
// pair, and only while at least one of them is on. They are independent, and
// clearing the last one switches both geometries off (see setTrajectoryViews
// in MapStateProvider).
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

  const lastTrajectoryKey = TRAJECTORY_LAYER_KEYS[TRAJECTORY_LAYER_KEYS.length - 1]

  function option (key, label, hint, checked, onToggle) {
    return (
      <div
        key={key}
        className={`optionButton ${checked ? 'selected' : ''}`}
        onClick={onToggle}
      >
        {checked ? <CheckSquare /> : <Square />}
        <span className='optionName'>
          {label}
          {hint && <span className='optionHint'>{hint}</span>}
        </span>
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
            t(DATA_LAYER_HINT_KEYS[key]),
            isDataLayerChecked(dataLayers, key),
            () => toggleDataLayer(key)
          )}
          {key === lastTrajectoryKey && anyTrajectoryLayerOn(dataLayers) && (
            <div className='dataLayerSubOptions'>
              <div className='dataLayerSubHeading'>
                {t('layerTrajectoryViewsLabel')}
              </div>
              {option(
                'tracksMode',
                t('layerTracksMode'),
                null,
                tracksMode,
                toggleTrackLines
              )}
              {option(
                'trajectoryHexes',
                t('layerTrajectoryHexes'),
                null,
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
