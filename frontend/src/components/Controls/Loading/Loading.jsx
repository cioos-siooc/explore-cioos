import * as React from 'react'
import { Spinner } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import './styles.css'

export default function Loading() {
  const { i18n } = useTranslation()

  return (
    <div className='loading'>
      {i18n.language === 'en' ?
        <a className={'spinnerLogo englishLogo'} /> :
        <a className={'spinnerLogo frenchLogo'} />
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