import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dropdown, DropdownButton } from '../../ui/Dropdown.jsx'
import { SWATCHES } from '../DatasetPreview/previewColors.js'

// The colour one variable draws in. Twelve preset swatches, "back to what the
// dataset says", and a native field for anything else.
//
// `color` is the OVERRIDE — null when the variable is still drawing in the colour
// its ERDDAP colorBarPalette implies, which is what `defaultColor` holds. Both
// are needed: the chip shows the colour in use, the menu shows whether it is a
// choice or a default.
//
// WHY THE CUSTOM FIELD IS DEBOUNCED
// React's onChange on <input type="color"> is the DOM `input` event, which fires
// on every pointer move inside the OS colour dialog. Each one would rewrite the
// query string and re-plot every panel, so the chip follows the pointer from
// local state and the choice is committed once the pointer has been still for a
// moment. The field is also deliberately NOT a Dropdown.Item: an Item closes the
// menu on click (ui/Dropdown.jsx), and the menu has to outlive the dialog.
const COMMIT_DELAY_MS = 250

export default function VariableColorPicker ({
  color,
  defaultColor,
  onPick,
  label
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(null)
  const timer = useRef(null)

  useEffect(() => () => clearTimeout(timer.current), [])

  const inUse = draft || color || defaultColor

  const pick = (value) => {
    clearTimeout(timer.current)
    setDraft(null)
    onPick(value)
  }

  const drag = (value) => {
    setDraft(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => onPick(value), COMMIT_DELAY_MS)
  }

  return (
    <DropdownButton
      className='dropdownButtonSwatch'
      align='center'
      tooltip={label}
      title={
        <span
          className='colorSwatch'
          style={{ backgroundColor: inUse }}
          aria-hidden='true'
        />
      }
    >
      <div className='colorSwatchGrid'>
        {SWATCHES.map((hex) => (
          <Dropdown.Item
            key={hex}
            active={inUse === hex}
            onClick={() => pick(hex)}
            title={hex}
            aria-label={hex}
          >
            <span
              className='colorSwatch'
              style={{ backgroundColor: hex }}
              aria-hidden='true'
            />
          </Dropdown.Item>
        ))}
      </div>
      <hr />
      <Dropdown.Item active={!color} onClick={() => pick(null)}>
        <span
          className='colorSwatch'
          style={{ backgroundColor: defaultColor }}
          aria-hidden='true'
        />
        {t('datasetPreviewPlotColorDefault')}
      </Dropdown.Item>
      <label className='colorSwatchCustom'>
        {t('datasetPreviewPlotColorCustom')}
        <input
          type='color'
          value={inUse}
          onChange={(event) => drag(event.target.value)}
        />
      </label>
    </DropdownButton>
  )
}
