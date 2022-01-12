import classNames from 'classnames'
import * as React from 'react'
import { useState } from 'react'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'

import './styles.css'

export default function SelectionPanel({ children }) {
  const [open, setOpen] = useState(true)
  let selectionPanelClassName = classNames('selectionPanel', { open: open })
  return (
    <div className={selectionPanelClassName}>
      <div className='panelContents' style={{ 'display': open ? 'inherit' : 'none' }}>
        {children}
      </div>
      {children &&
        (
          <div className='panelHandle' title={`${open ? 'Close' : 'Open'} selection panel`} onClick={() => setOpen(!open)}>
            {open ? <ChevronCompactLeft /> : <ChevronCompactRight />}
          </div>
        )
      }
    </div>
  )
}