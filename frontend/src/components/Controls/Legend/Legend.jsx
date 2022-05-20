import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as _ from 'lodash'

import { capitalizeFirstLetter, generateColorStops } from '../../../utilities.js'
import { colorScale, platformColors } from '../../config.js'

import './styles.css'
import { ChevronCompactDown, ChevronCompactUp, CircleFill } from 'react-bootstrap-icons'

export default function Legend({ currentRangeLevel, zoom }) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(false)
  const colorStops = generateColorStops(colorScale, currentRangeLevel)
  return (
    <div className={`legend ${legendOpen && 'open'}`} >
      {currentRangeLevel[0] !== null && currentRangeLevel[1] !== null ?
        zoom < 7 ?
          <>
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
          </>
          :
          <div className='legendElementRow'>
            <div className='legendElement' title='One day of data or less'>
              {legendOpen && <div className='circleLabel'>One day of data or less</div>}
              <CircleFill size={2} className='legendPlatformCircle pointSize' fill='white' />
            </div>
            <div className='legendElement' title='More than one day of data'>
              {legendOpen && <div className='circleLabel'>More than one day of data</div>}
              <CircleFill size={15} className='legendPlatformCircle pointSize' fill='white' />
            </div>
            |
            {platformColors.map(pc => {
              return (
                <div className='legendElement' title={capitalizeFirstLetter(pc.platformType)}>
                  {legendOpen && <div className='circleLabel'>{pc.platformType}</div>}
                  <CircleFill size={15} className='legendPlatformCircle' fill={pc.platformColor} />
                </div>
              )
            })}
          </div>
        :
        <div
          title={t('legendNoDataWarningTitle')} //'Choose less restrictive filters to see data'
        >
          {t('legendNoDataWarningText')}
          {/* No Data */}
        </div>
      }
      <div className='legendToggle' title={legendOpen ? 'Close legend' : 'Open legend'} onClick={() => setLegendOpen(!legendOpen)}>
        {legendOpen ?
          <ChevronCompactDown />
          :
          <ChevronCompactUp />
        }
      </div>
    </div >
  )
}