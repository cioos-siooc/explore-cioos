import * as React from 'react'
import {useState, forwardRef} from 'react'
import {Col, Row, Button} from 'react-bootstrap'
import RangeSlider from 'react-bootstrap-range-slider'
import Slider, { SliderTooltip } from 'rc-slider';

import 'react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css';
import 'rc-slider/assets/index.css';
import './styles.css'

export default function DepthSelector() {
  const { createSliderWithTooltip } = Slider;
  const Range = createSliderWithTooltip(Slider.Range);

  const [startDepth, setStartDepth] = useState(0)
  const [endDepth, setEndDepth] = useState(100)

  return (
    <Row className='depthSelector' xs='auto'>
      <Col >
      <Row>
        <Col>
          Start Depth (m): 
          <input value={startDepth} type='number' max={1000} min={0} onChange={(e) => setStartDepth(e.target.value)}/>
        </Col>
        <Col>
          End Depth (m):
          <input value={endDepth} type='number' max={1000} min={0} onChange={(e) => setEndDepth(e.target.value)}/>
        </Col>
      </Row>
      <Row>
        <Col>
          <div style={{ width: 385, margin: '15px 0px 0px 15px' }}>
            <Range 
              min={0} 
              max={1000} 
              defaultValue={[0, 100]}
              value={[startDepth, endDepth]} 
              tipFormatter={value => `${value}m`} 
              onChange={(value) => {
                setStartDepth(value[0]) 
                setEndDepth(value[1])
              }}
            />
          </div>
        </Col>
      </Row>
      </Col>
     </Row>
  )
}