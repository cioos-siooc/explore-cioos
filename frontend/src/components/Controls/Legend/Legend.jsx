import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronCompactLeft,
  ChevronCompactRight,
  CircleFill,
  HexagonFill
} from 'react-bootstrap-icons'

import {
  capitalizeFirstLetter,
  generateColorStops
} from '../../../utilities.js'
import { colorScale, trajectoryColorScale, TRAIL_ALL } from '../../config.js'
import platformColors from '../../platformColors'

import './styles.css'
import LegendElement from './LegendElement.jsx/LegendElement.jsx'
import classNames from 'classnames'
import isEmpty from 'lodash/isEmpty'

export default function Legend({
  currentRangeLevel,
  currentTrajectoryRangeLevel,
  zoom,
  selectionPanelOpen,
  platformsInView,
  tracksMode,
  trailingDays,
  dataLayers
}) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)

  // Default all-on when the prop is absent (older callers / initial render).
  const layers = dataLayers || { profiles: true, obis: true, trajectories: true }
  // The combined green ramp / platform points carry profiles + OBIS, plus
  // trajectory coverage when shown as hexes.
  const showPointRamp =
    layers.profiles || layers.obis || (layers.trajectories && !tracksMode)

  function generateLegendElements() {
    if (!showPointRamp) return null
    if (isEmpty(currentRangeLevel)) {
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
              style={{
                border: '1px solid black',
                borderRadius: '15px'
              }}
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
  function generateTrajectoryLegendElements() {
    // Trajectory layer hidden entirely — no trajectory legend.
    if (!layers.trajectories) return null
    // Tracks mode replaces the coverage-hex ramp with the track-line layers.
    if (tracksMode) {
      return (
        <>
          <hr />
          <LegendElement
            title={`${t('legendTrackLine')} (${
              trailingDays === TRAIL_ALL ? t('timeBarTrailAll') : `${trailingDays}d`
            })`}
            open={legendOpen}
          >
            <svg width='15' height='15'>
              <line
                x1='1'
                y1='13'
                x2='14'
                y2='2'
                stroke='#6749AC'
                strokeWidth='2.5'
                strokeLinecap='round'
              />
            </svg>
          </LegendElement>
          <LegendElement title={t('legendTrackHead')} open={legendOpen}>
            {/* same arrowhead the map draws, pointing along the course */}
            <svg width='15' height='15' viewBox='0 0 16 16'>
              <path
                d='M8 1.5 L13.5 13.5 L8 10.5 L2.5 13.5 Z'
                fill='#6749AC'
                stroke='#ffffff'
                strokeWidth='1.5'
                strokeLinejoin='round'
                transform='rotate(45 8 8)'
              />
            </svg>
          </LegendElement>
        </>
      )
    }
    if (isEmpty(currentTrajectoryRangeLevel)) return null

    // Trajectory coverage always renders as hexes, at every zoom level.
    const trajectoryColorStops = generateColorStops(
      trajectoryColorScale,
      currentTrajectoryRangeLevel
    )
    return (
      <>
        <hr />
        <LegendElement
          title={t('legendSectionTitleTrajectoriesPerHex')}
          // title='- Trajectories per hexagon'
          open={legendOpen}
        >
          {t('legendSectionColor')}
          {/* Color */}
        </LegendElement>
        {trajectoryColorStops &&
          trajectoryColorStops.map((colorStop, index) => {
            const trajectoryCount = `${colorStop.stop}`
            return (
              <LegendElement
                key={index}
                title={trajectoryCount}
                open={legendOpen}
              >
                <HexagonFill
                  title={trajectoryCount}
                  size={15}
                  fill={colorStop.color}
                />
              </LegendElement>
            )
          })}
      </>
    )
  }
  const className = classNames('legend', { panelOpen: selectionPanelOpen })
  return (
    <div className={className} onClick={() => setLegendOpen(!legendOpen)}>
      {generateLegendElements()}
      {generateTrajectoryLegendElements()}
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
