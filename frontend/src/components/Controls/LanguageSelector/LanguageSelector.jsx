import * as React from 'react'
import { useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { Check } from 'react-bootstrap-icons'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'
import { languages } from '../../config'
import './styles.css'

export default function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || 'en')

  function updateMapToolTitleLanguage() {
    let polygonToolDiv = document.getElementsByClassName('mapbox-gl-draw_polygon')
    polygonToolDiv[0].title = t('mapPolygonToolTitle')

    let deleteToolDiv = document.getElementsByClassName('mapbox-gl-draw_trash')
    deleteToolDiv[0].title = t('mapDeleteToolTitle')

    let zoomInToolDiv = document.getElementsByClassName('mapboxgl-ctrl-zoom-in')
    zoomInToolDiv[0].title = t('mapZoomInToolTitle')

    let zoomOutToolDiv = document.getElementsByClassName('mapboxgl-ctrl-zoom-out')
    zoomOutToolDiv[0].title = t('mapZoomOutToolTitle')

    let orientNorthToolDiv = document.getElementsByClassName('mapboxgl-ctrl-compass')
    orientNorthToolDiv[0].title = t('mapCompassToolTitle')
  }

  return (
    <div className='languageSelector'>
      <Dropdown
        drop='left'
      >
        <Dropdown.Toggle >
          {selectedLanguage.toLocaleUpperCase()}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {languages.map(({ code, name }, index) => {
            return (
              <Dropdown.Item
                key={index}
                onClick={() => {
                  setSelectedLanguage(code)
                  i18next.changeLanguage(code)
                  // change URL lang parameter
                  let url = new URL(window.location.href)
                  url.searchParams.set('lang', code)
                  history.replaceState(null, '', url)
                  updateMapToolTitleLanguage()
                }}
                disabled={selectedLanguage === code}
              >
                {name}{selectedLanguage === code && <Check />}
              </Dropdown.Item>
            )
          })}
        </Dropdown.Menu>
      </Dropdown>
    </div >
  )
}