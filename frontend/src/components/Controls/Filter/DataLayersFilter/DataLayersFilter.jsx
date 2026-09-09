/* eslint-disable react/prop-types */

import * as React from 'react'
import { CheckSquare, Square } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import {
  DATA_LAYER_HINT_KEYS,
  DATA_LAYER_KEYS,
  DATA_LAYER_LABEL_KEYS,
  isDataLayerChecked
} from '../../../../state/dataLayers.js'
import { useMapState } from '../../../../state/map/MapStateProvider.jsx'
import './styles.css'

// Which observation geometries the map draws. It behaves as every other filter
// does, down to the semantics and not just the idiom: no ticks means unfiltered
// (all seven drawn), ticking narrows to what is ticked, and unticking the last
// one returns to all. The selection gates the datasets list and its counts for
// every row (see datasetInDataLayers), and additionally gates the map's point/
// hex tiles for the six point- and path-sampling rows — grid has no tile
// equivalent to narrow, since griddap coverage is its own map layer.
//
// Each row carries a hint line: what the geometry means in plain terms and the
// platforms that typically produce it. "TimeSeriesProfile" tells a data manager
// exactly what it is and a visitor nothing at all, and the hint is what closes
// that gap without renaming the CF types.
//
// Seven rows and nothing else. The track-lines / hex-cells switches used to
// hang off the trajectory pair here, which put the same two controls in two
// places once the legend grew switches of its own — and they never belonged in
// a filter: they change how the trajectories are drawn, not which datasets are
// selected. They live on the legend entries they key (see Legend.jsx).
export default function DataLayersFilter () {
  const { t } = useTranslation()
  const { dataLayers, toggleDataLayer } = useMapState()

  return (
    <div className='multiCheckboxFilter dataLayersFilter'>
      {DATA_LAYER_KEYS.map((key) => {
        const checked = isDataLayerChecked(dataLayers, key)
        return (
          <div
            key={key}
            className={`optionButton ${checked ? 'selected' : ''}`}
            onClick={() => toggleDataLayer(key)}
          >
            {checked ? <CheckSquare /> : <Square />}
            <span className='optionName'>
              {t(DATA_LAYER_LABEL_KEYS[key])}
              <span className='optionHint'>{t(DATA_LAYER_HINT_KEYS[key])}</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
