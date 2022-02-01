import * as React from 'react'
import { Spinner } from 'react-bootstrap'
import './styles.css'

export default function Loading() {
  return (
    <div className='loading'>
      <a className='spinnerLogo' />
      <Spinner
        className='spinner'
        as="span"
        animation="border"
        size={70}
        role="status"
        aria-hidden="true"
      />
    </div>
  )
}