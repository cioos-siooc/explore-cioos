import * as React from 'react'
import { Spinner } from 'react-bootstrap'
import './styles.css'

export default function Loading () {
  const urlLanguage = new URL(window.location.href).searchParams.get('lang')
  return (
    <div className='loading'>
      {!urlLanguage || urlLanguage === 'en'
        ? <a className={'spinnerLogo englishLogo'} />
        : <a className={'spinnerLogo frenchLogo'} />
      }
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
