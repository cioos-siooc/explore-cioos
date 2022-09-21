import classNames from 'classnames'
import * as React from 'react'
import { useState } from 'react'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'
import { useTranslation } from 'react-i18next'

import './styles.css'

export default function SelectionPanel({ open, setOpen, children }) {
  const { t } = useTranslation()
  const selectionPanelClassName = classNames('selectionPanel', {
    closed: !open
  })
  const panelContentsClassName = classNames('panelContents', {
    closed: !open
  })
  const panelHandleClassName = classNames('panelHandle', { closed: !open })
  return (
    <div className={selectionPanelClassName}>
      <div className={panelContentsClassName}>{children}</div>
      {children && (
        <div
          className={panelHandleClassName}
          title={`${
            open
              ? t('selectionPanelHandleTitleClose')
              : t('selectionPanelHandleTitleOpen')
          } ${t('selectionPanelHandleTitleText')}`}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronCompactLeft /> : <ChevronCompactRight />}
        </div>
      )}
    </div>
  )
}
