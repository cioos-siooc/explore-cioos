import * as React from 'react'
import PropTypes from 'prop-types'
import {Col, Row, Button} from 'react-bootstrap'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css";
import './styles.css'

export default function TimeSelector(props) {
  var earliestDateAllowed = new Date()
  earliestDateAllowed.setDate(earliestDateAllowed.getDate() - (365 * 20))

  return (
    <div className='timeSelector'>
      <Row>
        <Col xs={6}>
          Start Date: {props.startDate.toLocaleDateString()}
          <DatePicker
            selected={props.startDate}
            onChange={date => props.setStartDate(date)}
            minDate={earliestDateAllowed}
            maxDate={new Date(props.endDate).setDate(props.endDate.getDate())}
            inline
            fixedHeight
            peekNextMonth
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
            />
        </Col>
        <Col xs={6}>
          End Date: {props.endDate.toLocaleDateString()}
          <DatePicker
            selected={props.endDate}
            onChange={date => props.setEndDate(date)}
            minDate={new Date(props.startDate).setDate(props.startDate.getDate() + 1)}
            maxDate={new Date()}
            inline
            fixedHeight
            peekNextMonth
            showMonthDropdown
            showYearDropdown
            dropdownMode="select"
          />
        </Col>
      </Row>
    </div>
  )
}

TimeSelector.propTypes = {
  startDate: PropTypes.object.isRequired,
  endDate: PropTypes.object.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired
}