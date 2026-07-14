import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { createDataFilterQueryString } from '../utilities.jsx'
import { useFilters } from './filters/FilterProvider.jsx'
import { useMapState } from './map/MapStateProvider.jsx'

// Sole owner of the URL format: serializes the debounced query + map view
// into the search params (shareable links), and keeps i18n in sync with the
// lang param. Reading URL state on load happens where the state lives
// (FilterProvider seeds filters, MapStateProvider seeds the map view).
//
// The open dataset page is the exception: SelectionProvider owns the
// dataset/server params and derives its state from them, so this sync must
// carry them through rather than drop them (it rebuilds the whole search
// string from scratch on every map pan).
export default function UrlSync () {
  const [searchParams] = useSearchParams()
  const lang = searchParams.get('lang') || 'en'
  const dataset = searchParams.get('dataset')
  const server = searchParams.get('server')
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
      lang,
      ...(dataset ? { dataset } : {}),
      ...(dataset && server ? { server } : {})
    }
    const combined = new URLSearchParams(obj)
    // Replace, never push: this mirrors state the app never reads back out of
    // the URL, so an entry per map pan would only bury the history entries
    // that do mean something (opening a dataset page).
    navigate('?' + combined.toString(), { replace: true })
  }, [query, mapView])

  useEffect(() => {
    if (lang !== i18n.language) {
      i18n.changeLanguage(lang)
    }
  }, [lang])

  return null
}
