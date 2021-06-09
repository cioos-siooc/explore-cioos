import * as React from 'react'
import {useState, forwardRef} from 'react'
import {Col, Row, Button} from 'react-bootstrap'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css";
import './styles.css'

export default function TimeSelector() {
  const showCalendarToggle = false
  const [useSingleCalendar, setUseSingleCalendar] = useState(false)
  var startDateInit = new Date()
  startDateInit.setHours(0, 0, 0, 0)
  startDateInit.setDate(startDateInit.getDate() - 7)
  var earliestDateAllowed = new Date()
  earliestDateAllowed.setDate(earliestDateAllowed.getDate() - 60)
  const [startDate, setStartDate] = useState(useSingleCalendar? new Date() : startDateInit);
  const [endDate, setEndDate] = useState(useSingleCalendar ? null : new Date());
  const onChange = (dates) => {
    const [start, end] = dates;
    setStartDate(start);
    setEndDate(end);
  };

  const ExampleCustomInput = forwardRef(({ value, onClick }, ref) => (
    <Button className="example-custom-input" onClick={onClick} ref={ref}>
      {value}
    </Button>
  ));

  return (
    <div className='timeSelector'>
      {showCalendarToggle && <Button onClick={() => setUseSingleCalendar(!useSingleCalendar)}>Toggle Calendar Type: {useSingleCalendar ? 'single' : 'double'}</Button>}
      {useSingleCalendar ?
          <Row>
            <Col>
              Select Timeframe
              <DatePicker
                selected={startDate}
                onChange={onChange}
                startDate={startDate}
                endDate={endDate}
                selectsRange
                inline
                />
            </Col>
          </Row>
        :
          <Row>
            <Col xs={6}>
                Start Date
                <DatePicker
                  selected={startDate}
                  onChange={date => setStartDate(date)}
                  minDate={earliestDateAllowed}
                  maxDate={new Date(endDate).setDate(endDate.getDate() - 1)}
                  // customInput={<ExampleCustomInput/>}
                  />
            </Col>
            <Col xs={6}>
                End Date
                <DatePicker
                  selected={endDate}
                  onChange={date => setEndDate(date)}
                  minDate={new Date(startDate).setDate(startDate.getDate() + 1)}
                  maxDate={new Date()}
                  // customInput={<ExampleCustomInput/>}
                />
            </Col>
          </Row>
        }
      </div>
      )
}