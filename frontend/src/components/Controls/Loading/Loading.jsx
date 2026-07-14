import * as React from 'react'
import Spinner from '../../ui/Spinner.jsx'
import './styles.css'

// A scrim + spinner covering the nearest positioned ancestor.
//
// variant='brand' (default) adds the CIOOS logo above the spinner: it's the
// app's first-paint splash (index.jsx's Suspense fallback, the initial map
// load), where the wait is long enough to be worth branding.
// variant='inline' is the same scrim without the logo, for a panel or section
// refreshing in place — the logo reads as "the app is booting" and is wrong
// once it isn't.
export default function Loading ({ variant = 'brand' }) {
  const urlLanguage = new URL(window.location.href).searchParams.get('lang')
  return (
    <div className='loading'>
      {variant === 'brand' &&
        (!urlLanguage || urlLanguage === 'en' ? (
          <a className={'spinnerLogo englishLogo'} />
        ) : (
          <a className={'spinnerLogo frenchLogo'} />
        ))}
      <Spinner className='spinner' />
    </div>
  )
}
