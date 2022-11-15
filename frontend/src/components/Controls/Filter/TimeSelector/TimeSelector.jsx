import * as React from 'react'
import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import RangeSelector from '../RangeSelector/RangeSelector.jsx'
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
    if (tempDate <= new Date(endDate)) {
      // && tempDate >= new Date(defaultStartDate) && tempDate <= new Date(defaultEndDate)) {
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
    if (tempDate >= new Date(startDate)) {
      // } && tempDate >= new Date(defaultStartDate) && tempDate <= new Date(defaultEndDate)) {
      setDateValid(true)
      props.setEndDate(date)
      props.setStartDate(startDate)
    } else {
      setDateValid(false)
    }
  }

  function onChange(value) {
    const tempStartDate = new Date(value[0]).toISOString().split('T')[0]
    const tempEndDate = new Date(value[1]).toISOString().split('T')[0]
    if (startDate !== tempStartDate) {
      handleSetStartDate(tempStartDate)
    } else if (endDate !== tempEndDate) {
      handleSetEndDate(tempEndDate)
    }
  }

  const dateToday = new Date().getTime()

  return (
    <div className='timeSelector'>
      <div className='depthQuickSelectGrid'>
        <button
          onClick={() => {
            const date = new Date()
            props.setEndDate(date.toISOString().split('T')[0])
            props.setStartDate(new Date(date.getTime() - 10 * 86400000).toISOString().split('T')[0])
          }}
        >
          {t('timeSelectorQuickSelect10Days')}
        </button>
        <button
          onClick={() => {
            const date = new Date()
            props.setEndDate(date.toISOString().split('T')[0])
            props.setStartDate(new Date(date.getTime() - 30 * 86400000).toISOString().split('T')[0])
          }}
        >
          {t('timeSelectorQuickSelect30Days')}
        </button>
        <button
          onClick={() => {
            const date = new Date()
            props.setEndDate(date.toISOString().split('T')[0])
            props.setStartDate(new Date(date.getTime() - 365 * 86400000).toISOString().split('T')[0])
          }}
        >
          {t('timeSelectorQuickSelect1Year')}
        </button>
        <button
          onClick={() => {
            const date = new Date()
            props.setEndDate(date.toISOString().split('T')[0])
            props.setStartDate(new Date(date.getTime() - 3652 * 86400000).toISOString().split('T')[0])
          }}
        >
          {t('timeSelectorQuickSelect10Years')}
        </button>
      </div>
      <div className='date'>
        <span>
          {t('timeSelectorStartDate')}
          {/* Start Date: */}
        </span>
        <input
          type='date'
          value={startDate}
          max={new Date().toISOString().split('T')[0]}
          min='1900-01-01'
          onChange={(e) => handleSetStartDate(e.target.value)}
        />
      </div>
      <div className='date'>
        <span>
          {t('timeSelectorEndDate')}
          {/* End Date: */}
        </span>
        <input
          type='date'
          value={endDate}
          max={new Date().toISOString().split('T')[0]}
          min='1900-01-01'
          onChange={(e) => handleSetEndDate(e.target.value)}
        />
      </div>
      <RangeSelector
        start={new Date(props.startDate).getTime()}
        end={new Date(props.endDate).getTime()}
        marks={{
          '-2208960000000': '1900',
          // '-1893427200000': '1910',
          '-1577894400000': '1920',
          // '-1262275200000': '1930',
          '-946742400000': '1940',
          // '-631123200000': '1950',
          '-315590400000': '1960',
          // '28800000': '1970',
          '315561600000': '1980',
          // '631180800000': '1990',
          '946713600000': '2000',
          // '1262332800000': '2010',
          '1577865600000': '2020',
          [dateToday]: '',
        }}
        min={-2208960000000}
        max={dateToday}
        onChange={onChange}
      />
      {!dateValid && (
        <div>
          {' '}
          <X color='red' size={30} /> {t('dateFilterInvalidWarning')}
        </div>
      )}
    </div>
  )
}

TimeSelector.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  setStartDate: PropTypes.func.isRequired,
  setEndDate: PropTypes.func.isRequired
}
