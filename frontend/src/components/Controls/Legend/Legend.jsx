import React, { useEffect } from 'react'
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronCompactDown, ChevronCompactLeft, ChevronCompactRight, ChevronCompactUp, CircleFill, HexagonFill } from 'react-bootstrap-icons'
import * as _ from 'lodash'

import { capitalizeFirstLetter, useOutsideAlerter, generateColorStops } from '../../../utilities.js'
import { colorScale, platformColors } from '../../config.js'

import './styles.css'
import LegendElement from './LegendElement.jsx/LegendElement.jsx'
import classNames from 'classnames'

export default function Legend({ currentRangeLevel, zoom, selectionPanelOpen }) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)
  const [legendHover, setLegendHover] = useState(false)
  const [legendType, setLegendType] = useState('No Data')
  const wrapperRef = useRef(null)
  useOutsideAlerter(wrapperRef, setLegendOpen, false)

  useEffect(() => {
    if (_.isEmpty(currentRangeLevel)) {
      setLegendType('No Data')
    } else {
      if (zoom < 7) {
        setLegendType('Points per hexagon')
      } else {
        setLegendType('Platform type')
      }
    }
  }, [currentRangeLevel, zoom])

  function generateLegendElements() {
    if (_.isEmpty(currentRangeLevel)) { // No Data
      return (
        <div
          title={t('legendNoDataWarningTitle')} //'Choose less restrictive filters to see data'
        >
          {t('legendNoDataWarningText')}
          {/* No Data */}
        </div>
      )
    } else if (zoom < 7) { // Hexes
      const colorStops = generateColorStops(colorScale, currentRangeLevel)
      return (
        <>
          {colorStops && colorStops.map((colorStop, index) => {
            const pointCount = `${colorStop.stop}` //`${colorStop.stop === 1 ? `${colorStop.stop} ${t('legendTitleText')}` : `${colorStop.stop} ${t('legendTitleTextPlural')}`}`
            return (
              <LegendElement
                key={index}
                title={pointCount}
                open={legendOpen}
              >
                <HexagonFill title={pointCount} size={15} fill={colorStop.color} />
              </LegendElement>
            )
          })
          }
        </>
      )
    } else if (zoom >= 7) { // Points
      return (
        <>
          <LegendElement
            title='One day of data or less'
            open={legendOpen}
          >
            <CircleFill size={2} fill='white' style={{ border: '1px solid black', borderRadius: '15px' }} />
          </LegendElement>
          <LegendElement
            title='More than one day of data'
            open={legendOpen}
          >
            <CircleFill size={15} fill='white' style={{ border: '1px solid black', borderRadius: '15px' }} />
          </LegendElement>
          <hr />
          {platformColors.map(pc => {
            return (
              <LegendElement
                title={capitalizeFirstLetter(pc.platformType)}
                open={legendOpen}
              >
                <CircleFill size={15} fill={pc.platformColor} />
              </LegendElement>
            )
          })}
        </>
      )
    }
  }
  const className = classNames('legend', { panelOpen: selectionPanelOpen, legendHover: legendHover })

  return (
    <div
      className={className}
      ref={wrapperRef}
      onClick={() => setLegendOpen(!legendOpen)}
      onMouseEnter={() => setLegendHover(true)}
      onMouseLeave={() => setLegendHover(false)}
    >
      {generateLegendElements()}
      <LegendElement
        // title={legendType}
        open={legendOpen ? true : legendHover}
      >
        {legendOpen ?
          <ChevronCompactLeft />
          :
          <ChevronCompactRight />
        }
      </LegendElement>
    </div>
  )
}