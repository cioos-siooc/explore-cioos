import * as React from 'react'
import { useState } from 'react'
import { Dropdown } from 'react-bootstrap'
import { Check } from 'react-bootstrap-icons'
import i18next from 'i18next'

import { languages } from '../../config'
import './styles.css'

export default function LanguageSelector() {
  const [selectedLanguage, setSelectedLanguage] = useState('en')

  return (
    <div className='languageSelector'>
      <Dropdown
        drop='up'
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