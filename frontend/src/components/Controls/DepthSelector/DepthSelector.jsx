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
          <Col xs={{span: 5, offset: 0}}>Start Depth (m):</Col>
          <Col xs={{span: 1, offset: 2}}>
            <input
              style={{width: '130px'}}
              className="startDepth"
              value={props.startDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setStartDepth(e.target.value)}
              size={"6"}
            />
          </Col>
        </Row>
        <Row>
          <Col xs={{span: 5, offset: 0}}>End Depth (m):</Col>
          <Col xs={{span: 1, offset: 2}}>
            <input
              style={{width: '130px'}}
              className="endDepth"
              value={props.endDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setEndDepth(e.target.value)}
              size={"6"}
            />
          </Col>
        </Row>
        <Row>
          <Col>
            <div style={{ width: 330, margin: "15px 0px 0px 15px" }}>
              <RangeSelector
                setStartDepth={props.setStartDepth}
                setEndDepth={props.setEndDepth}
              />
            </div>
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
