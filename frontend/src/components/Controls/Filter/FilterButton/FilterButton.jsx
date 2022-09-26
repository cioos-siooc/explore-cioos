import _ from 'lodash'
import React from 'react'
import { OverlayTrigger, Tooltip } from 'react-bootstrap'
import { X } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function FilterButton({ setOptionsSelected, optionsSelected, option }) {
  const { t, i18n } = useTranslation()
  const tooltipText = option[`hover_${i18n.language}`] || option.title

  const filterOptionSelected = !_.isEmpty(optionsSelected.filter(opt => option.pk === opt.pk && opt.isSelected))

  return (
    <OverlayTrigger
      placement='bottom'
      delay={{ show: 150, hide: 0 }}
      overlay={
        <Tooltip style={{ display: tooltipText ? '' : 'none' }}>
          {tooltipText}
        </Tooltip>
      }
    >
      <button
        className={`filterButton ${filterOptionSelected && 'selected'}`}
        onClick={() => {
          setOptionsSelected(optionsSelected.map(opt => {
            if (option.pk === opt.pk) {
              return {
                ...opt,
                isSelected: !opt.isSelected
              }
            } else return opt
          }))
        }}
      >
        {t(option.title)}{filterOptionSelected && <X size='25' color='darkgrey' />}
      </button>
    </OverlayTrigger>
  )
}