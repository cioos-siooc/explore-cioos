import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactDown,
  ChevronCompactUp,
  CircleFill,
  HexagonFill
} from 'react-bootstrap-icons'

import {
  capitalizeFirstLetter,
  generateColorStops
} from '../../../utilities.js'
import { colorScale, trajectoryColorScale } from '../../config.js'
import platformColors from '../../platformColors'

import './styles.css'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

// Compact floating legend card (top-right). A small header collapses the
// body; the sections switch with zoom (hex ramp below z7, point size +
// platform colors above).
export default function Legend({
  currentRangeLevel,
  currentTrajectoryRangeLevel,
  zoom,
  platformsInView
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)

  function renderRampSection(caption, scale, rangeLevel, key) {
    const colorStops = generateColorStops(scale, rangeLevel)
    if (!colorStops) return null
    return (
      <div className='legendSection' key={key}>
        <div className='legendSectionCaption'>{caption}</div>
        <div className='legendItems'>
          {colorStops.map((colorStop, index) => (
            <div className='legendItem' key={index}>
              <HexagonFill
                className='legendSwatch'
                size={12}
                fill={colorStop.color}
                aria-hidden='true'
              />
              <span className='legendItemLabel'>{colorStop.stop}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  function generateLegendElements() {
    if (isEmpty(currentRangeLevel)) {
      return (
        <div className='legendNoData' title={t('legendNoDataWarningTitle')}>
          {t('legendNoDataWarningText')}
        </div>
      )
    } else if (zoom < 7) {
      // Hexes
      return renderRampSection(
        t('legendPointsPerHex'),
        colorScale,
        currentRangeLevel,
        'hexes'
      )
    } else {
      // Points
      return (
        <>
          <div className='legendSection'>
            <div className='legendSectionCaption'>{t('legendDaysOfData')}</div>
            <div className='legendItems'>
              <div
                className='legendItem'
                title={t('legendSectionTitleLessOneDayOfData')}
              >
                <span className='legendSwatch'>
                  <span className='legendPointCircle small' />
                </span>
                <span className='legendItemLabel'>
                  {t('legendOneDayOrLess')}
                </span>
              </div>
              <div
                className='legendItem'
                title={t('legendSectionTitleMoreOneDayOfData')}
              >
                <span className='legendSwatch'>
                  <span className='legendPointCircle large' />
                </span>
                <span className='legendItemLabel'>
                  {t('legendMoreThanOneDay')}
                </span>
              </div>
            </div>
          </div>
          <div className='legendSection'>
            <div className='legendSectionCaption'>
              {t('legendPlatformType')}
            </div>
            <div className='legendItems'>
              {platformColors
                .filter((pc) => platformsInView.includes(pc.platform))
                .map((pc) => (
                  <div className='legendItem' key={pc.platform}>
                    <CircleFill
                      className='legendSwatch'
                      size={10}
                      fill={pc.color}
                      aria-hidden='true'
                    />
                    <span className='legendItemLabel'>
                      {capitalizeFirstLetter(t(pc.platform))}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </>
      )
    }
  }

  function generateTrajectoryLegendElements() {
    if (isEmpty(currentTrajectoryRangeLevel)) return null
    // Trajectory coverage always renders as hexes, at every zoom level.
    return renderRampSection(
      t('legendTrajectoriesPerHex'),
      trajectoryColorScale,
      currentTrajectoryRangeLevel,
      'trajectories'
    )
  }

  return (
    <div className={classNames('legend', { closed: !legendOpen })}>
      <button
        className='legendHeader'
        onClick={() => setLegendOpen(!legendOpen)}
        title={legendOpen ? t('closeLegendTooltip') : t('openLegendTooltip')}
        aria-expanded={legendOpen}
      >
        <span>{t('legendTitle')}</span>
        {legendOpen ? (
          <ChevronCompactUp size={14} aria-hidden='true' />
        ) : (
          <ChevronCompactDown size={14} aria-hidden='true' />
        )}
      </button>
      {legendOpen && (
        <div className='legendBody'>
          {generateLegendElements()}
          {generateTrajectoryLegendElements()}
        </div>
      )}
    </div>
  )
}
