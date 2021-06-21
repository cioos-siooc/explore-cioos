import React, {useEffect, useState} from 'react'
import { Row, Button, Tooltip, OverlayTrigger} from 'react-bootstrap'
import { Check, CheckCircle, XCircle } from 'react-bootstrap-icons'
import PropTypes from 'prop-types'
import './styles.css'

export default function SubmitRequest (props) {
  const [email, setEmail] = useState('')
  const [emailValid, setEmailValid] = useState(false)
  const [queryRequested, setQueryRequested] = useState(false)
  const [querySubmitted, setQuerySubmitted] = useState(false)
  const [queryError, setQueryError] = useState(false)
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
    }
  }, [props.filtersChanged])

  useEffect(() => {
    setEmailValid(validateEmail(email))
    setQueryRequested(false)
    setQuerySubmitted(false)
  }, [email])

  useEffect(() => {
    if(polygonCreated && emailValid) {
      console.log(JSON.stringify(props.map.getPolygon()))
      fetch(`https://pac-dev2.cioos.org/ceda/download?${props.query}&polygon=${JSON.stringify(props.map.getPolygon())}&email=${email}`).then((value) => {
        if(value.ok) {
          setQuerySubmitted(true)
        }
      }).catch(error => {
        console.log(error)
        setQueryRequested(false)
        setQuerySubmitted(false)
      })
    } else {
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
    if(!polygonCreated || !emailValid) {
      setButtonText('Not Ready')
      setButtonVariant('secondary')
    } else if(polygonCreated && emailValid && !querySubmitted) {
      setButtonText('Submit Request')
      setButtonVariant('primary')
    } else if(polygonCreated && emailValid && querySubmitted) {
      setButtonText('Request Submitted')
      setButtonVariant('success')
    }
  }, [polygonCreated, emailValid, querySubmitted])

  const buttonTooltip = (polygonCreated && emailValid) ? 'Submit request' : (emailValid ? 'Add polygon map selection to request data' : 'Add valid email address')
  return (
    <Row className='submitRequest'>
      <OverlayTrigger
        key='emailInputKey'
        placement='top'
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
        placement='top'
        overlay={
          <Tooltip id={`tooltip-left`}>
            {emailValid ? 'Valid email address' : 'Invalid email address'}
          </Tooltip>
        }
      >
        {emailValid ? 
          <CheckCircle color='#212529' style={{backgroundColor: '#d4edda', borderRadius: '2rem' }} size={20} className='indicatorIcon'/> : 
          <XCircle color='##212529' style={{backgroundColor: '#fff3cd', borderRadius: '2rem' }} size={20} className='indicatorIcon'/>
        }
      </OverlayTrigger>
      <OverlayTrigger
        key='submitKey'
        placement='top'
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
          {buttonText}
        </Button>
      </OverlayTrigger>
    </Row>
  )
}


SubmitRequest.propTypes = {
  map: PropTypes.object.isRequired,
  query: PropTypes.string.isRequired,
  filtersChanged: PropTypes.bool.isRequired
}