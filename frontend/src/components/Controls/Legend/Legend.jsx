import * as React from 'react'
import { generateColorStops } from '../../../utilities.js'
import { colorScale } from '../../config.js'
import { useTranslation } from 'react-i18next'
import * as _ from 'lodash'

import './styles.css'

export default function Legend({ currentRangeLevel }) {
  const { t } = useTranslation()
  const colorStops = generateColorStops(colorScale, currentRangeLevel)
  return (currentRangeLevel[0] !== null && currentRangeLevel[1] !== null ?
    <div className='legend' >
      {currentRangeLevel[0]}
      {colorStops &&
        colorStops.map((colorStop, index) => {
          return (
            <div
              className='colorStop'
              key={index}
              style={{ 'backgroundColor': colorStop.color }}
              title={`${colorStop.stop === 1 ? `${colorStop.stop} ${t('legendTitleText')}` : `${colorStop.stop} ${t('legendTitleTextPlural')}`}`}
            />
          )
        })
      }
      {colorStops.length > 1 && currentRangeLevel[1]}
    </div>
    :
    <div
      className='legend'
      title={t('legendNoDataWarningTitle')} //'Choose less restrictive filters to see data'
    >
      {t('legendNoDataWarningText')}
      {/* No Data */}
    </div>
  )
}