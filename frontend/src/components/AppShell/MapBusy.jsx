import * as React from 'react'
import { useTranslation } from 'react-i18next'

import Spinner from '../ui/Spinner.jsx'

// The map redrawing after the first load — new tiles for a changed filter, a
// fresh selection polygon. Unlike the initial load there's already a usable
// map on screen, so this is a quiet pill rather than the full-screen splash.
export default function MapBusy () {
  const { t } = useTranslation()

  return (
    <div className='mapBusy' role='status' aria-live='polite'>
      <Spinner size='sm' />
      <span>{t('mapUpdatingText')}</span>
    </div>
  )
}
