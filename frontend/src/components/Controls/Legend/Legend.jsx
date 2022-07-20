import React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronCompactLeft, ChevronCompactRight, CircleFill, HexagonFill } from 'react-bootstrap-icons'
import * as chroma from "chroma-js"
import * as d3 from 'd3-scale-chromatic'
import * as _ from 'lodash'

import { capitalizeFirstLetter, generateColorStops } from '../../../utilities.js'
import { colorScale } from '../../config.js'
import platformColors from '../../platformColors'

import './styles.css'
import LegendElement from './LegendElement.jsx/LegendElement.jsx'
import classNames from 'classnames'

export default function Legend({ currentRangeLevel, zoom, selectionPanelOpen, platformsInView }) {
  const { t } = useTranslation()
  const [legendOpen, setLegendOpen] = useState(true)

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
          <LegendElement
            title={t('legendSectionTitlePointsPerHex')}
            // title='- Points per hexagon'
            open={legendOpen}
          >
            {t('legendSectionColor')}
            {/* Color */}
          </LegendElement>
          {colorStops && colorStops.map((colorStop, index) => {
            const pointCount = `${colorStop.stop}`
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
            <CircleFill size={4} fill='white' style={{ border: '1px solid black', borderRadius: '15px', margin: '5.5px' }} />
          </LegendElement>
          <LegendElement
            title={t('legendSectionTitleMoreOneDayOfData')}
            // title='More than one day of data'
            open={legendOpen}
          >
            <CircleFill size={15} fill='white' style={{ border: '1px solid black', borderRadius: '15px' }} />
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
          {platformColors.filter(pc => platformsInView.includes(pc.platform)).map(pc => {
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
  // const colors = chroma.scale('greys').gamma(0.5).mode('lab').colors(7).slice(1)
  // colors.push(...chroma.scale('reds').gamma(0.5).mode('lab').colors(7).slice(1))
  // colors.push(...chroma.scale('blues').gamma(0.5).mode('lab').colors(7).slice(1))
  // colors.push(...chroma.scale('greens').gamma(0.5).mode('lab').colors(7).slice(1))
  // colors.push(...chroma.scale('purples').gamma(0.5).mode('lab').colors(7).slice(1))
  // colors.push(...chroma.scale(['#f6dbf6', '#ff03ff']).mode('lab').colors(7).slice(1))
  // // colors.push(...chroma.scale('yellows').gamma(0.5).mode('lab').colors(7).slice(1))

  // const colors = d3.schemeCategory10
  // colors.push('#000000')

  // https://observablehq.com/@camerongarrett/c-labs-color-palette
  // const colors = ["#c73174", "#433acb", "#009976", "#ffd000", "#eb5846", "#a0179f", "#005fbb", "#00b14e", "#ff8e10", "#7918c1", "#96c31e", "#007e9b", "#000000"]
  // const colors = ["#52a79b", "#c73174", "#0050c4", "#00b545", "#f1613d", "#9914a7", "#0078a2", "#c3c900", "#6724c8", "#ffa700", "#000000"]

  /*
  Fixed (6)
  Boats (14)
  Buoys (11)
  Submersible (7)
  Ice (5)
  Animals (8)
  Vehicles (7)
  Gliders (3)
  Space (6)
  Air (12)
  Uknown/ungrouped (2)
  */

  // http://vrl.cs.brown.edu/color
  //const colors = ["#50a79b", "#7ce5e6", "#1d686e", "#7feb90", "#1d8a20", "#c9dd87", "#6a7f2f", "#e6bfa2", "#863c2c", "#db6f8a", "#000000"]
  const colors = ["#50a79b", "#bb0749", "#fdc7cc", "#6404b7", "#cd6ad8", "#e38744", "#1b4dab", "#76480d", "#2a6b2a", "#e23209", "#3693f2", "#ea3ffc", "#8fca40", "#f7d153", "#000000"]
  return (
    <div
      className={className}
      onClick={() => setLegendOpen(!legendOpen)}
    >
      {/* {colors.map((color, index) => {
        return (
          <LegendElement
            key={index}
            title={color}
            open={legendOpen}
          >
            <CircleFill size={15} fill={color} />
          </LegendElement>
        )
      })} */}
      {generateLegendElements()}
      <LegendElement
        open={legendOpen}
      >
        <div className='legendToggleButton' title={legendOpen ? t('closeLegendTooltip') : t('openLegendTooltip')}> {/*'Close legend' 'Open legend'*/}
          {legendOpen ?
            <ChevronCompactLeft />
            :
            <ChevronCompactRight />
          }
        </div>
      </LegendElement>
    </div>
  )
}