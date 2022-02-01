import * as React from 'react'
import { useEffect } from 'react'

import './styles.css'

export default function Legend({ colorScale, legendLevel }) {
  console.log('legendLevel:', legendLevel)
  const colorStops = [{ stop: 1, color: 'red' }, { stop: 2, color: 'green' }, { stop: 3, color: 'blue' }, { stop: 4, color: 'yellow' }]
  return (
    <div className='legend' >
      Legend:
      {colorStops.map((colorStop, index) => {
        return (
          <div className='colorStop' key={index} style={{ 'backgroundColor': colorStop.color }} title={`${colorStop.stop} record(s)`} />
        )
      })}
    </div>
  )
}