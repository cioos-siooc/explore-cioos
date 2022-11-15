import * as React from 'react'
import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import { useTranslation } from 'react-i18next'
import { X } from 'react-bootstrap-icons'

import RangeSelector from '../RangeSelector/RangeSelector.jsx'
import './styles.css'

export default function DepthSelector (props) {
  const { t } = useTranslation()

  const [startDepth, setStartDepth] = useState(props.startDepth)
  const [endDepth, setEndDepth] = useState(props.endDepth)
  const [depthValid, setDepthValid] = useState(true)

  useEffect(() => {
    setStartDepth(props.startDepth)
    setDepthValid(true)
  }, [props.startDepth])

  useEffect(() => {
    setEndDepth(props.endDepth)
    setDepthValid(true)
  }, [props.endDepth])

  function handleSetStartDepth (value) {
    setStartDepth(value * 1.0)
    if (value * 1.0 <= endDepth && value * 1.0 >= 0 && value * 1.0 <= 12000) {
      setDepthValid(true)
      props.setStartDepth(value * 1.0)
      props.setEndDepth(endDepth)
    } else {
      setDepthValid(false)
    }
  }

  function handleSetEndDepth (value) {
    setEndDepth(value * 1.0)
    if (value * 1.0 >= startDepth && value * 1.0 >= 0 && value * 1.0 <= 12000) {
      setDepthValid(true)
      props.setEndDepth(value * 1.0)
      props.setStartDepth(startDepth)
    } else {
      setDepthValid(false)
    }
  }

  function onChange(value) {
    props.setStartDepth(value[0])
    props.setEndDepth(value[1])
  }

  return (
    <div className='depthSelector'>
      <div className='inputs'>
        <div className='depthQuickSelectGrid'>
          <button
            onClick={() => {
              props.setStartDepth(0)
              props.setEndDepth(100)
            }}
          >
            100 m
          </button>
          <button
            onClick={() => {
              props.setStartDepth(0)
              props.setEndDepth(500)
            }}
          >
            500 m
          </button>
          <button
            onClick={() => {
              props.setStartDepth(0)
              props.setEndDepth(1000)
            }}
          >
            1000 m
          </button>
          <button
            onClick={() => {
              props.setStartDepth(1000)
              props.setEndDepth(12000)
            }}
          >
            1000+ m
          </button>
        </div>
        <div
          className='depth'
          title={!depthValid ? t('depthFilterStartInvalidTitle') : undefined}
        >
          <span>{t('depthFilterStartDepth')}</span>
          <input
            className='startDepth'
            value={startDepth}
            type='number'
            max={12000}
            min={0}
            onChange={(e) => handleSetStartDepth(e.target.value)}
            size={'6'}
          />
        </div>
        <div
          className='depth'
          title={!depthValid ? t('depthFilterEndInvalidTitle') : undefined}
        >
          <span>{t('depthFilterEndDepth')}</span>
          <input
            className='endDepth'
            value={endDepth}
            type='number'
            max={12000}
            min={0}
            onChange={(e) => handleSetEndDepth(e.target.value)}
            size={'6'}
          />
        </div>
      </div>
      <RangeSelector
        start={props.startDepth}
        end={props.endDepth}
        marks={{
          0: '0m',
          2000: '2000m',
          4000: '4000m',
          6000: '6000m',
          8000: '8000m',
          10000: '10000m',
          12000: '12000m'
        }}
        min={0}
        max={12000}
        onChange={onChange}
      />
      {!depthValid && (
        <div>
          {' '}
          <X color='red' size={30} /> {t('depthFilterInvalidWarning')}
        </div>
      )}
    </div>
  )
}

DepthSelector.propTypes = {
  startDepth: PropTypes.number.isRequired,
  setStartDepth: PropTypes.func.isRequired,
  endDepth: PropTypes.number.isRequired,
  setEndDepth: PropTypes.func.isRequired
}
