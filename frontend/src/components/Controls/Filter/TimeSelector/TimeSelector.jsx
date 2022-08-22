import * as React from 'react'
import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import './styles.css'

// Spacing elements out to the left and right using justify-content: space-between. https://medium.com/12-developer-labors/css-all-the-ways-to-align-elements-left-and-right-52ecce4a4af9
export default function TimeSelector (props) {
  const { t } = useTranslation()

  const [startDate, setStartDate] = useState(props.startDate)
  const [endDate, setEndDate] = useState(props.endDate)
  const [dateValid, setDateValid] = useState(true)

  useEffect(() => {
    setStartDate(props.startDate)
    setDateValid(true)
  }, [props.startDate])

  useEffect(() => {
    setEndDate(props.endDate)
    setDateValid(true)
  }, [props.endDate])

  function handleSetStartDate (date) {
    const tempDate = new Date(date)
    setStartDate(date)
    if (tempDate <= new Date(endDate)) { // && tempDate >= new Date(defaultStartDate) && tempDate <= new Date(defaultEndDate)) {
      setDateValid(true)
      props.setStartDate(date)
      props.setEndDate(endDate)
    } else {
      setDateValid(false)
    }
  }

  function handleSetEndDate (date) {
    const tempDate = new Date(date)
    setEndDate(date)
    if (tempDate >= new Date(startDate)) { // } && tempDate >= new Date(defaultStartDate) && tempDate <= new Date(defaultEndDate)) {
      setDateValid(true)
      props.setEndDate(date)
      props.setStartDate(startDate)
    } else {
      setDateValid(false)
    }
  }

  return (
    <div className='timeSelector'>
      <div className='date'>
        <span>
          {t('timeSelectorStartDate')}
          {/* Start Date: */}
        </span>
        <input
          type="date"
          value={startDate}
          max="9999-12-31"
          min="0000-01-01"
          onChange={(e) => handleSetStartDate(e.target.value)}
        />
      </div>
      <div className='date'>
        <span>
          {t('timeSelectorEndDate')}
          {/* End Date: */}
        </span>
        <input
          type="date"
          value={endDate}
          max="9999-12-31"
          min="0000-01-01"
          onChange={(e) => handleSetEndDate(e.target.value)}
        />
      </div>
      {!dateValid && (<div> <X color='red' size={30} /> {t('dateFilterInvalidWarning')}</div>)}
    </div>
  )
}

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired
}
