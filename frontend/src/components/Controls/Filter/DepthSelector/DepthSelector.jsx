import * as React from "react";
import PropTypes from "prop-types";
import { Col, Row, Button } from "react-bootstrap";
import RangeSelector from "./RangeSelector.jsx";

import "react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css";
import "rc-slider/assets/index.css";

export default function DepthSelector(props) {
  return (
    <Row className="timeSelector">
      <Col>
        <Row>
          <Col xs='auto' >Start Depth (m):</Col>
          <Col xs='auto'>
            <input
              style={{ width: '130px' }}
              className="startDepth"
              value={props.startDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setStartDepth(e.target.value * 1.0)} // Force type-conversion to number
              size={"6"}
            />
          </Col>
        </Row>
        <Row>
          <Col xs='auto'>End Depth (m):</Col>
          <Col xs='auto'>
            <input
              style={{ width: '130px' }}
              className="endDepth"
              value={props.endDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setEndDepth(e.target.value * 1.0)} // Force type-conversion to number
              size={"6"}
            />
          </Col>
        </Row>
        <Row>
          <Col>
            <RangeSelector
              startDepth={props.startDepth}
              endDepth={props.endDepth}
              setStartDepth={props.setStartDepth}
              setEndDepth={props.setEndDepth}
            />
          </Col>
        </Row>
      </Col>
    </Row>
  );
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  endDepth: PropTypes.number.isRequired,
  setEndDepth: PropTypes.func.isRequired,
};
