import * as React from 'react'
import {useState, forwardRef} from 'react'
import {Col, Row, Button} from 'react-bootstrap'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css";

export default function TimeSelector() {
  var startDateInit = new Date()
  startDateInit.setHours(0, 0, 0, 0)
  startDateInit.setDate(startDateInit.getDate() - 7)
  var earliestDateAllowed = new Date()
  earliestDateAllowed.setDate(earliestDateAllowed.getDate() - 60)
  const [startDate, setStartDate] = useState(startDateInit)
  const [endDate, setEndDate] = useState(new Date())

  const ExampleCustomInput = forwardRef(({ value, onClick }, ref) => (
    <Button className="example-custom-input" onClick={onClick} ref={ref}>
      {value}
    </Button>
  ));

  return (
    <Row className='timeSelector'>
      <Col>
        <span>
          Start Date
        </span>
        <div>
          <DatePicker
            selected={startDate}
            onChange={date => setStartDate(date)}
            minDate={earliestDateAllowed}
            maxDate={new Date(endDate).setDate(endDate.getDate() - 1)}
            customInput={<ExampleCustomInput/>}
          />
        </div>
      </Col>
      <Col xs='auto' lg>
        <hr></hr>
      </Col>
      <Col className='timeframeSelectionEndDate' xs='auto'>
        <span>
          End Date
        </span>
        <div>
          <DatePicker
            selected={endDate}
            onChange={date => setEndDate(date)}
            minDate={new Date(startDate).setDate(startDate.getDate() + 1)}
            maxDate={new Date()}
            customInput={<ExampleCustomInput/>}
          />
        </div>
      </Col>
     </Row>
  )
}