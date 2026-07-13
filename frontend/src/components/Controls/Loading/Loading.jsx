import * as React from 'react'
import Spinner from '../../ui/Spinner.jsx'
import './styles.css'

export default function Loading () {
  const urlLanguage = new URL(window.location.href).searchParams.get('lang')
  return (
    <div className='loading'>
      {!urlLanguage || urlLanguage === 'en' ? (
        <a className={'spinnerLogo englishLogo'} />
      ) : (
        <a className={'spinnerLogo frenchLogo'} />
      )}
      <Spinner className='spinner' />
    </div>
  )
}
