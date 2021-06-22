import * as React from "react";
import PropTypes from "prop-types";
import { Col, Row, Button } from "react-bootstrap";

export default function TimeSelector(props) {
  console.log('startDate',props.startDate);
  console.log('endDate',props.endDate);
  return (
    <div className="timeSelector">
      <Row>
        <Col xs>Start Date:</Col>
        <Col xs>
          <input
            type="date"
            value={props.startDate}
            max={props.endDate}
            onChange={(e) => {
              
              props.setStartDate(e.target.value || null);
            }}
          />
        </Col>
      </Row>
      <Row>
        <Col xs>End Date:</Col>
        <Col xs>
          <input
            type="date"
            value={props.endDate}
            min={props.startDate}
            onChange={(e) => props.setEndDate(e.target.value  || null)}
          />
        </Col>
      </Row>
    </div>
  );
}

TimeSelector.propTypes = {
  startDate: PropTypes.object.isRequired,
  endDate: PropTypes.object.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired,
};
