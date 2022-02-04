import * as React from "react";
import PropTypes from "prop-types";
import RangeSelector from "../RangeSelector/RangeSelector.jsx";

import "react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css";
import "rc-slider/assets/index.css";

import './styles.css'

export default function DepthSelector(props) {

  return (
    <div className='depthSelector'>
      <div className='inputs'>
        <div className='depth'>
          <span>Start Depth (m):</span>
          <input
            className="startDepth"
            value={props.startDepth}
            type="number"
            max={12000}
            min={0}
            onChange={(e) => {
              if (e.target.value * 1.0 < props.endDepth) {
                props.setStartDepth(e.target.value * 1.0) // Force type-conversion to number
              }
            }}
            size={"6"}
          />
        </div>
        <div className='depth'>
          <span>End Depth (m):</span>
          <input
            className="endDepth"
            value={props.endDepth}
            type="number"
            max={12000}
            min={0}
            onChange={(e) => {
              if (e.target.value * 1.0 > props.startDepth) {
                props.setEndDepth(e.target.value * 1.0) // Force type-conversion to number
              }
            }}
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
    </div>
  );
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  endDepth: PropTypes.number.isRequired,
  setEndDepth: PropTypes.func.isRequired,
};
