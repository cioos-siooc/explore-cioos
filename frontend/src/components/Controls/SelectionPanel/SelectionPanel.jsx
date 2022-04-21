import classNames from 'classnames'
import * as React from 'react'
import { useState } from 'react'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function SelectionPanel({ children }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(true)
  let selectionPanelClassName = classNames('selectionPanel', { closed: !open })
  let panelContentsClassName = classNames('panelContents', { closed: !open })
  let panelHandleClassName = classNames('panelHandle', { closed: !open })
  return (
    <div className={selectionPanelClassName}>
      <div className={panelContentsClassName}>
        {children}
      </div>
      {children &&
        (
          <div
            className={panelHandleClassName}
            title={`${open ?
              t('selectionPanelHandleTitleClose') :
              t('selectionPanelHandleTitleOpen')} ${t('selectionPanelHandleTitleText')}`}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronCompactLeft /> : <ChevronCompactRight />}
          </div>
        )
      }
    </div >
  )
}