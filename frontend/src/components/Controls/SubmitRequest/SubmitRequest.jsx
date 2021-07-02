import React, {useEffect, useState} from 'react'
import { Row, Button, Tooltip, OverlayTrigger, Spinner} from 'react-bootstrap'
import { Check, CheckCircle, XCircle } from 'react-bootstrap-icons'
import PropTypes from 'prop-types'
import './styles.css'

import {server} from '../../../config'

export default function SubmitRequest (props) {
  const [email, setEmail] = useState('')
  const [emailValid, setEmailValid] = useState(false)
  const [queryRequested, setQueryRequested] = useState(false)
  const [querySubmitted, setQuerySubmitted] = useState(false)
  const [queryFetch, setQueryFetch] = useState(false)
  const [queryFailed, setQueryFailed] = useState(false)
  const [polygonCreated, setPolygonCreated] = useState(false)
  const [buttonText, setButtonText] = useState('Not Ready')
  const [buttonVariant, setButtonVariant] = useState('secondary')

  function validateEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  }

  useEffect(() => {
    if(props.filtersChanged) {
      setQuerySubmitted(false)
      setQueryRequested(false)
      setQueryFailed(false)
    }
  }, [props.filtersChanged])

  useEffect(() => {
    setEmailValid(validateEmail(email))
    setQueryRequested(false)
    setQuerySubmitted(false)
    setQueryFailed(false)
  }, [email])

  useEffect(() => {
    if(polygonCreated && emailValid && !props.filtersChanged) {
      setQueryFetch(true)
      fetch(`${server}/download?${props.query}&polygon=${JSON.stringify(props.map.getPolygon())}&email=${email}`).then((value) => {
        if(value.ok) {
          setQueryFetch(false)
          setQuerySubmitted(true)
        } else {
          setQueryFetch(false)
          setQuerySubmitted(false)
          setQueryFailed(true)
        }
      }).catch(error => {
        setQueryFetch(false)
        setQueryRequested(false)
        setQuerySubmitted(false)
      })
    } else {
      setQueryFetch(false)
      setQueryRequested(false)
      setQuerySubmitted(false)
    }
  }, [queryRequested])

  useEffect(() => {
    setInterval(() => {
      if(props.map.getPolygon()) {
        setPolygonCreated(true)
      } else {
        setPolygonCreated(false)
        setQueryRequested(false)
        setQuerySubmitted(false)
      }
    }, 500);
  }, [])

  useEffect(() => {
    if(queryFailed) {
      setButtonText('Query Failed')
      setButtonVariant('warning')
    } else if(!polygonCreated || !emailValid || props.filtersChanged) {
      setButtonText('Not Ready')
      setButtonVariant('secondary')
    } else if(polygonCreated && emailValid && !querySubmitted && !props.filtersChanged) {
      setButtonText('Submit Request')
      setButtonVariant('primary')
    } else if(polygonCreated && emailValid && querySubmitted && !props.filtersChanged) {
      setButtonText('Request Submitted')
      setButtonVariant('success')
    }
  }, [polygonCreated, emailValid, querySubmitted, props.filtersChanged, queryFailed])

  let buttonTooltip // = (polygonCreated && emailValid) ? 'Submit request' : (emailValid ? 'Add polygon map selection to request data' : 'Add valid email address')
  if(queryFailed) {
    buttonTooltip = 'Query failed: email not permitted or no data found'
  } else if(polygonCreated && emailValid && !props.filtersChanged) {
    buttonTooltip = 'Submit request'
  } else if (!emailValid) {
    buttonTooltip = 'Add valid email address'
  } else if (!polygonCreated) {
    buttonTooltip = 'Add polygon map selection to request data'
  } else if (props.filtersChanged) {
    buttonTooltip = 'Apply filters before submitting request'
  }

  return (
    <div className='submitRequest'>
      <OverlayTrigger
        key='emailInputKey'
        placement='bottom'
        overlay={
          <Tooltip id={`tooltip-left`}>
            Email address to receive data download link
          </Tooltip>
        }
      >
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder='exampleEmail@cioos.ca' className='emailInput'/>
      </OverlayTrigger>
      <OverlayTrigger
        key='emailValidityIndicatorKey'
        placement='bottom'
        overlay={
          <Tooltip id={`tooltip-left`}>
            {emailValid ? 'Valid email address' : 'Invalid email address'}
          </Tooltip>
        }
      >
        {emailValid ? 
          <CheckCircle color='#212529' style={{backgroundColor: '#d4edda', borderRadius: '2rem', opacity:0.5}} size={20} className='indicatorIcon'/> : 
          <XCircle color='##212529' style={{backgroundColor: '#fff3cd', borderRadius: '2rem', opacity:0.5}} size={20} className='indicatorIcon'/>
        }
      </OverlayTrigger>
      <OverlayTrigger
        key='submitKey'
        placement='bottom'
        overlay={
          <Tooltip id={`tooltip-left`}>
            {buttonTooltip}
          </Tooltip>
        }
        >
        <Button 
          className='submitQueryButton' 
          onClick={() => setQueryRequested(true)}
          variant={buttonVariant}
          >
          <span>
            {buttonText}
          </span>
          {queryFetch && 
            <Spinner
              className='ml-2'
              as="span"
              animation="border"
              size="sm"
              role="status"
              aria-hidden="true"
            />
          }
        </Button>
      </OverlayTrigger>
    </div>
  )
}


SubmitRequest.propTypes = {
  map: PropTypes.object.isRequired,
  query: PropTypes.string.isRequired,
  filtersChanged: PropTypes.bool.isRequired
}