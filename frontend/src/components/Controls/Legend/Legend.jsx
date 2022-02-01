import * as React from 'react'
import { generateColorStops } from '../../../utilities.js'
import { colorScale } from '../../config.js'

import './styles.css'

export default function Legend({ legendLevel }) {
  const colorStops = generateColorStops(colorScale, legendLevel)
  return (
    <div className='legend' >
      Legend: ({legendLevel && legendLevel[0]})
      {colorStops && colorStops.map((colorStop, index) => {
        return (
          <div className='colorStop' key={index} style={{ 'backgroundColor': colorStop.color }} title={`${colorStop.stop} record(s)`} />
        )
      })} ({legendLevel && legendLevel[1]})
    </div>
  )
}