import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactLeft,
  ChevronCompactRight,
  CircleFill,
  HexagonFill
} from 'react-bootstrap-icons'
import * as _ from 'lodash'

import {
  capitalizeFirstLetter,
  generateColorStops
} from '../../../utilities.js'
import { colorScale } from '../../config.js'
import platformColors from '../../platformColors'

import './styles.css'
import LegendElement from './LegendElement.jsx/LegendElement.jsx'
import classNames from 'classnames'

export default function Legend({
  currentRangeLevel,
  zoom,
  selectionPanelOpen,
  platformsInView
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)

  function generateLegendElements() {
    if (_.isEmpty(currentRangeLevel)) {
      // No Data
      return (
        <div
          title={t('legendNoDataWarningTitle')} // 'Choose less restrictive filters to see data'
        >
          {t('legendNoDataWarningText')}
          {/* No Data */}
        </div>
      )
    } else if (zoom < 7) {
      // Hexes
      const colorStops = generateColorStops(colorScale, currentRangeLevel)
      return (
        <>
          <LegendElement
            title={t('legendSectionTitlePointsPerHex')}
            // title='- Points per hexagon'
            open={legendOpen}
          >
            {t('legendSectionColor')}
            {/* Color */}
          </LegendElement>
          {colorStops &&
            colorStops.map((colorStop, index) => {
              const pointCount = `${colorStop.stop}`
              return (
                <LegendElement key={index} title={pointCount} open={legendOpen}>
                  <HexagonFill
                    title={pointCount}
                    size={15}
                    fill={colorStop.color}
                  />
                </LegendElement>
              )
            })}
        </>
      )
    } else if (zoom >= 7) {
      // Points
      return (
        <>
          <LegendElement
            title={t('legendSectionTitleDaysOfData')}
            // title='- Days of data'
            open={legendOpen}
          >
            {t('legendSectionSize')}
            {/* Size */}
          </LegendElement>
          <LegendElement
            title={t('legendSectionTitleLessOneDayOfData')}
            // title='One day of data or less'
            open={legendOpen}
          >
            <CircleFill
              size={4}
              fill='white'
              style={{
                border: '1px solid black',
                borderRadius: '15px',
                margin: '5.5px'
              }}
            />
          </LegendElement>
          <LegendElement
            title={t('legendSectionTitleMoreOneDayOfData')}
            // title='More than one day of data'
            open={legendOpen}
          >
            <CircleFill
              size={15}
              fill='white'
              style={{ border: '1px solid black', borderRadius: '15px' }}
            />
          </LegendElement>
          <hr />
          <LegendElement
            title={t('legendSectionTitlePlatformType')}
            // title='- Platform type'
            open={legendOpen}
          >
            {t('legendSectionColor')}
            {/* Color */}
          </LegendElement>
          {platformColors
            .filter((pc) => platformsInView.includes(pc.platform))
            .map((pc) => {
              return (
                <LegendElement
                  title={capitalizeFirstLetter(t(pc.platform))}
                  open={legendOpen}
                  key={pc.platform}
                >
                  <CircleFill size={15} fill={pc.color} />
                </LegendElement>
              )
            })}
        </>
      )
    }
  }
  const className = classNames('legend', { panelOpen: selectionPanelOpen })
  return (
    <div className={className} onClick={() => setLegendOpen(!legendOpen)}>
      {generateLegendElements()}
      <LegendElement open={legendOpen}>
        <div
          className='legendToggleButton'
          title={legendOpen ? t('closeLegendTooltip') : t('openLegendTooltip')}
        >
          {' '}
          {/* 'Close legend' 'Open legend' */}
          {legendOpen ? <ChevronCompactLeft /> : <ChevronCompactRight />}
        </div>
      </LegendElement>
    </div>
  )
}
