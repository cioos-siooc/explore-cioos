import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { createDataFilterQueryString } from '../utilities.js'
import { useFilters } from './filters/FilterProvider.jsx'
import { useMapState } from './map/MapStateProvider.jsx'

// Sole owner of the URL format: serializes the debounced query + map view
// into the search params (shareable links), and keeps i18n in sync with the
// lang param. Reading URL state on load happens where the state lives
// (FilterProvider seeds filters, MapStateProvider seeds the map view).
export default function UrlSync () {
  const [searchParams] = useSearchParams()
  const lang = searchParams.get('lang') || 'en'
  const { i18n } = useTranslation()
  const navigate = useNavigate()

  const { query } = useFilters()
  const { mapView } = useMapState()
  const [isPageLoad, setIsPageLoad] = useState(true)

  useEffect(() => {
    setIsPageLoad(false)
    if (isPageLoad) return
    const params2 = new URLSearchParams(createDataFilterQueryString(query))
    const obj = {
      ...mapView,
      ...Object.fromEntries(params2),
      lang
    }
    const combined = new URLSearchParams(obj)
    navigate('?' + combined.toString())
  }, [query, mapView])

  useEffect(() => {
    if (lang !== i18n.language) {
      i18n.changeLanguage(lang)
    }
  }, [lang])

  return null
}
