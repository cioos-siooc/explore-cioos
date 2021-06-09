import * as React from 'react'
import {useState, forwardRef} from 'react'
import {Col, Row, Button} from 'react-bootstrap'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css";
import './styles.css'

export default function TimeSelector() {
  var startDateInit = new Date()
  startDateInit.setHours(0, 0, 0, 0)
  startDateInit.setDate(startDateInit.getDate() - 7)
  var earliestDateAllowed = new Date()
  earliestDateAllowed.setDate(earliestDateAllowed.getDate() - (365 * 20))
  const [startDate, setStartDate] = useState(startDateInit);
  const [endDate, setEndDate] = useState(new Date());

  // const [tempStartDate, setTempStartDate] = useState(startDate.toLocaleDateString())
  // const [tempEndDate, setTempEndDate] = useState(endDate.toLocaleDateString())

  // function handleStartDateChange (dateString) {
  //  var newDate
  //   try {
  //     newDate = new Date(date)
  //     setStartDate(newDate)
  //   } catch (error) {
  //     console.log(error, 'incomplete date')
  //   }
  // }
  // function handleEndDateChange (dateString) {
  //   var newDate
  //   try {
  //     newDate = new Date(date)
  //     setEndDate(newDate)
  //   } catch (error) {
  //     console.log(error, 'incomplete date')
  //   }
  //  }

  return (
    <div className='timeSelector'>
        <Row>
          <Col xs={6}>
              Start Date: {startDate.toLocaleDateString()}
              {/* <input value={tempStartDate.toLocaleDateString()} onChange={(value) => handleStartDateChange(value)}/> */}
              <DatePicker
                selected={startDate}
                onChange={date => setStartDate(date)}
                minDate={earliestDateAllowed}
                maxDate={new Date(endDate).setDate(endDate.getDate() - 1)}
                inline
                fixedHeight
                peekNextMonth
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
                />
          </Col>
          <Col xs={6}>
              End Date: {endDate.toLocaleDateString()}
              {/* <input value={tempEndDate.toLocaleDateString()} onChange={(value) => handleEndDateChange(value)}/> */}
              <DatePicker
                selected={endDate}
                onChange={date => setEndDate(date)}
                minDate={new Date(startDate).setDate(startDate.getDate() + 1)}
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