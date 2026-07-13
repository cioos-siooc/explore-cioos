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
} from '../../../utilities.jsx'
import { colorScale, trajectoryColorScale, TRAIL_ALL } from '../../config.js'
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
  platformsInView,
  tracksMode,
  trailingDays,
  dataLayers
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)

  // Default all-on when the prop is absent (older callers / initial render).
  const layers = dataLayers || {
    profile: true,
    timeseries: true,
    timeseriesProfile: true,
    obis: true,
    trajectories: true,
    hexCells: true
  }
  // The combined green ramp / platform points carry the profile-family types
  // + OBIS, plus trajectory coverage when shown as hexes.
  const hasPointData =
    layers.profile ||
    layers.timeseries ||
    layers.timeseriesProfile ||
    layers.obis ||
    (layers.trajectories && !tracksMode)
  // Below zoom 7 the data draws only as hexes, so the ramp is meaningful only
  // when hex cells are on; at/above zoom 7 the point layer shows regardless.
  const showPointRamp = hasPointData && (zoom >= 7 || layers.hexCells)

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
    if (!showPointRamp) return null
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
    // Trajectory layer hidden entirely — no trajectory legend.
    if (!layers.trajectories) return null
    // Coverage hexes are hidden when hex cells are off (and it's not tracks
    // mode), so their ramp shouldn't show either.
    if (!tracksMode && !layers.hexCells) return null
    // Tracks mode replaces the coverage-hex ramp with the track-line layers.
    if (tracksMode) {
      return (
        <div className='legendSection' key='tracks'>
          <div className='legendSectionCaption'>{t('layerTrajectories')}</div>
          <div className='legendItems'>
            <div className='legendItem'>
              <svg className='legendSwatch' width='12' height='12'>
                <line
                  x1='1'
                  y1='10.5'
                  x2='11'
                  y2='1.5'
                  stroke='#6749AC'
                  strokeWidth='2.5'
                  strokeLinecap='round'
                />
              </svg>
              <span className='legendItemLabel'>
                {`${t('legendTrackLine')} (${
                  trailingDays === TRAIL_ALL
                    ? t('timeBarTrailAll')
                    : `${trailingDays}d`
                })`}
              </span>
            </div>
            <div className='legendItem'>
              {/* same arrowhead the map draws, pointing along the course */}
              <svg className='legendSwatch' width='12' height='12' viewBox='0 0 16 16'>
                <path
                  d='M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z'
                  fill='#6749AC'
                  stroke='#ffffff'
                  strokeWidth='1.5'
                  strokeLinejoin='round'
                  transform='rotate(45 8 8)'
                />
              </svg>
              <span className='legendItemLabel'>{t('legendTrackHead')}</span>
            </div>
          </div>
        </div>
      )
    }
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
