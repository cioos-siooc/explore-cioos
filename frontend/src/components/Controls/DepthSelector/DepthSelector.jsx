import * as React from "react";
import PropTypes from "prop-types";
import { Col, Row, Button } from "react-bootstrap";
import RangeSelector from "./RangeSelector.jsx";

import "react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css";
import "rc-slider/assets/index.css";
import "./styles.css";

export default function DepthSelector(props) {
  return (
    <Row className="depthSelector" xs="auto">
      <Col>
        <Row>
          <Col>
            Start Depth (m):
            <input
              className="startDepth"
              value={props.startDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setStartDepth(e.target.value)}
            />
            End Depth (m):
            <input
              className="endDepth"
              value={props.endDepth}
              type="number"
              max={12000}
              min={0}
              onChange={(e) => props.setEndDepth(e.target.value)}
            />
          </Col>
        </Row>
        <Row>
          <Col>
            <div style={{ width: 385, margin: "15px 0px 0px 15px" }}>
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
