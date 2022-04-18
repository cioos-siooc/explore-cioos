import * as React from 'react'
import { useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { Check } from 'react-bootstrap-icons'
import i18next from 'i18next'
import { useTranslation } from 'react-i18next'

import { languages } from '../../config'
import './styles.css'

export default function LanguageSelector() {
  const { i18n } = useTranslation()
  const [selectedLanguage, setSelectedLanguage] = useState(i18n.language || 'en')

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