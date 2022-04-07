import * as React from "react";
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import RangeSelector from "../RangeSelector/RangeSelector.jsx";

import "react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css";
import "rc-slider/assets/index.css";

import './styles.css'
import { X } from "react-bootstrap-icons";

export default function DepthSelector(props) {
  const [startDepth, setStartDepth] = useState(props.startDepth)
  const [endDepth, setEndDepth] = useState(props.endDepth)
  const [depthValid, setDepthValid] = useState(true)

  useEffect(() => {
    setStartDepth(props.startDepth)
    setDepthValid(true)
  }, [props.startDepth])

  useEffect(() => {
    setEndDepth(props.endDepth)
    setDepthValid(true)
  }, [props.endDepth])

  function handleSetStartDepth(value) {
    setStartDepth(value * 1.0)
    if (value * 1.0 <= endDepth && value * 1.0 >= 0 && value * 1.0 <= 12000) {
      setDepthValid(true)
      props.setStartDepth(value * 1.0)
      props.setEndDepth(endDepth)
    } else {
      setDepthValid(false)
    }
  }

  function handleSetEndDepth(value) {
    setEndDepth(value * 1.0)
    if (value * 1.0 >= startDepth && value * 1.0 >= 0 && value * 1.0 <= 12000) {
      setDepthValid(true)
      props.setEndDepth(value * 1.0)
      props.setStartDepth(startDepth)
    } else {
      setDepthValid(false)
    }
  }

  return (
    <div className='depthSelector'>
      <div className='inputs'>
        <div className='depth' title={!depthValid ? 'Start depth must be less than end depth, and be 0 to 12000m.' : undefined}>
          <span>Start Depth (m):</span>
          <input
            className="startDepth"
            value={startDepth}
            type="number"
            max={12000}
            min={0}
            onChange={e => handleSetStartDepth(e.target.value)}
            size={"6"}
          />
        </div>
        <div className='depth' title={!depthValid ? 'End depth must be more than start depth, and be 0 to 12000m' : undefined}>
          <span>End Depth (m):</span>
          <input
            className="endDepth"
            value={endDepth}
            type="number"
            max={12000}
            min={0}
            onChange={e => handleSetEndDepth(e.target.value)}
            size={"6"}
          />
        </div>
      </div>
      <RangeSelector
        startDepth={props.startDepth}
        endDepth={props.endDepth}
        setStartDepth={props.setStartDepth}
        setEndDepth={props.setEndDepth}
      />
      {!depthValid && (<div> <X color='red' size={30} /> Depth filter not applied, invalid values.</div>)}
    </div>
  );
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  endDepth: PropTypes.number.isRequired,
  setEndDepth: PropTypes.func.isRequired,
};
