import React from 'react'
import PropTypes from 'prop-types'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'

import './styles.css'

export default function RangeSelector({ start, end, marks, min, max, onChange }) {
  return (
    <div className='rangeSelector'>
      <Slider
        range
        // key={this.state.dynamicKey}
        min={min}
        max={max}
        value={[start, end]}
        onChange={(value) => onChange(value)}
        railStyle={{
          height: 2
        }}
        handleStyle={{
          height: 15,
          width: 15
        }}
        trackStyle={{
          background: 'none'
        }}
        marks={marks}
      />
    </div>
  )
}
