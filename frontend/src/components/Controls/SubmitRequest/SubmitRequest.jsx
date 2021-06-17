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

  function validateEmail(email) {
    const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  }

  useEffect(() => {
    setEmailValid(validateEmail(email))
  }, [email])

  function createPolygonQueryString () {
    console.log(props.map.getPolygon());
    query.polygon=JSON.stringify(props.map.getPolygon());

    return Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  }

  useEffect(() => {
    if(props.map.getPolygon()) {
      console.log(`https://pac-dev2.cioos.org/ceda/download?${createPolygonQueryString()}`)
      fetch(`https://pac-dev2.cioos.org/ceda/download?${createPolygonQueryString()}`).then((value) => {
        if(value.ok) {
          setQuerySubmitted(true)
        }
      }).catch(error => {
        console.log(error)
        setQueryError(true)
      })
    } else {
      setQueryError(true)
    }
  }, [querySubmitted])

  useEffect(() => {
    setInterval(() => {
      if(props.map.getPolygon()) {
        setPolygonCreated(true)
      } else {
        setPolygonCreated(false)
      }
    }, 500);
  }, [])

  const buttonTooltip = (polygonCreated && emailValid) ? 'Submit request' : (emailValid ? 'Add polygon map selection to request data' : 'Add valid email address')
  return (
    <Row className='submitRequest'>
      {/* {queryError && 'Error submitting query' } */}
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
          variant={(polygonCreated && emailValid) ? 'success' : 'secondary'}
          >
          Submit Request
        </Button>
      </OverlayTrigger>
    </Row>
  )
}


SubmitRequest.propTypes = {
  map: PropTypes.object.isRequired
}