import * as React from 'react'
import { useState, useEffect } from 'react'
import { server } from '../../../config'
import { createDataFilterQueryString, generateColorStops } from '../../../utilities'
import { colorScale } from '../../config.js'

import './styles.css'

export default function Legend({ zoom, query }) {
  const [loaded, setLoaded] = useState(false)
  const [legendLevels, setLegendLevels] = useState()
  const [legendLevel, setLegendLevel] = useState()

  useEffect(() => {
    fetch(`${server}/legend?${createDataFilterQueryString(query)}`).then(response => response.json()).then(legend => {
      if (legend) {
        setLegendLevels(legend.recordsCount)
        setLoaded(true)
      } else {
        console.log('legend query failed')
      }
    })
  }, [query])

  useEffect(() => {
    if (loaded) {
      switch (true) {
        case zoom < 5:
          setLegendLevel(legendLevels['zoom0'])
          break;
        case zoom >= 5 && zoom < 7:
          setLegendLevel(legendLevels['zoom1'])
          break;
        case zoom >= 7:
          setLegendLevel(legendLevels['zoom2'])
          break;
        default:
          console.log('no match in zoom switch case')
      }
    }
  }, [legendLevels, zoom])

  let colorStops
  if (legendLevel) {
    colorStops = generateColorStops(colorScale, legendLevel)
  }
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