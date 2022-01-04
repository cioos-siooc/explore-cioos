import * as React from "react";
import PropTypes from "prop-types";
import { Col, Row, Button } from "react-bootstrap";

export default function TimeSelector(props) {
  return (
    <div className="timeSelector">
      <Row>
        <Col xs={{span: 5, offset: 0}}>
        Start Date:
        </Col>
        <Col xs={{span: 3, offset: 1}}>
          <input
            style={{width: '185px'}}
            type="date"
            value={props.startDate}
            max={props.endDate}
            onChange={(e) => props.setStartDate(e.target.value)}
          />
        </Col>
      </Row>
      <Row>
        <Col xs={{span: 5, offset: 0}}>End Date:</Col>
        <Col  xs={{span: 3, offset: 1}}>
          <input
          style={{width: '185px'}}
            type="date"
            value={props.endDate}
            min={props.startDate}
            onChange={(e) => props.setEndDate(e.target.value)}
          />
        </Col>
      </Row>
    </div>
  );
}

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired,
};
