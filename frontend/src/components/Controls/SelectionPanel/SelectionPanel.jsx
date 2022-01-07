import classNames from 'classnames'
import * as React from 'react'
import { useState } from 'react'
import { ChevronCompactLeft, ChevronCompactRight } from 'react-bootstrap-icons'

import './styles.css'

export default function SelectionPanel({ children, selectionType }) {
  const [open, setOpen] = useState(true)
  let selectionPanelClassName = classNames('selectionPanel', { open: open })
  return (
    <div className={selectionPanelClassName}>
      {open &&
        <div className='panelContents'>
          {children}
        </div>
      }
      {selectionType !== 'none' &&
        (
          <div className='panelHandle' title={`${open ? 'Close' : 'Open'} selection panel`} onClick={() => setOpen(!open)}>
            {open ? <ChevronCompactLeft /> : <ChevronCompactRight />}
          </div>
        )
      }
    </div>
  )
}