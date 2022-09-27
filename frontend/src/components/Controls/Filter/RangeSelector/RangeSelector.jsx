import React from 'react'
import PropTypes from 'prop-types'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'

import './styles.css'

export default function RangeSelector({ start, setStart, end, setEnd, marks, min, max }) {
  // const [dynamicKey, setDynamicKey] = useState(Date.now())

  function onSliderChange(value) {
    setStart(value[0])
    setEnd(value[1])
  }

  // function onInputChange(value, index) {
  //   // When an input changes we set the dynamicKey
  //   // setDynamicKey(Date.now())

  //   if (value >= this.state.min && value <= this.state.max) {
  //     this.setState((state) => {
  //       state.value[index] = Number(value)
  //       return {
  //         value: state.value.sort((x, y) => x - y)
  //       }
  //     })
  //   }
  // }

  return (
    <div className='rangeSelector'>
      <Slider
        range
        // key={this.state.dynamicKey}
        min={min}
        max={max}
        value={[start, end]}
        onChange={() => onSliderChange()}
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
