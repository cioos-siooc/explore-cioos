import * as React from 'react'
import { generateColorStops } from '../../../utilities.js'
import { colorScale } from '../../config.js'

import './styles.css'

export default function Legend({ currentRangeLevel }) {
  const colorStops = generateColorStops(colorScale, currentRangeLevel)
  return (
    <div className='legend' >
      Legend: ({currentRangeLevel[0]})
      {colorStops && colorStops.map((colorStop, index) => {
        return (
          <div className='colorStop' key={index} style={{ 'backgroundColor': colorStop.color }} title={`${colorStop.stop} record(s)`} />
        )
      })} ({currentRangeLevel[1]})
    </div>
  )
}