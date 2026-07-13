import * as React from 'react'
import { createContext, useContext, useRef, useState } from 'react'

import { useOutsideAlerter } from '../../utilities.jsx'
import './dropdownStyles.css'

const DropdownContext = createContext({ close: () => {} })

// Replacement for react-bootstrap's DropdownButton + Dropdown.Item pair,
// emitting Bootstrap-compatible class names (.dropdown, .dropdown-toggle,
// .dropdown-menu, .dropdown-item) so existing overrides keep applying.
export function DropdownButton ({
  title,
  className = '',
  size,
  variant,
  children
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  useOutsideAlerter(wrapperRef, () => setOpen(false))

  const buttonClasses = [
    'btn',
    'dropdown-toggle',
    size && `btn-${size}`,
    variant && `btn-${variant}`
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`dropdown ${className}`} ref={wrapperRef}>
      <button
        type='button'
        className={buttonClasses}
        aria-expanded={open}
        aria-haspopup='listbox'
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open && (
        <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
          <div className='dropdown-menu show'>{children}</div>
        </DropdownContext.Provider>
      )}
    </div>
  )
}

function DropdownItem ({ onClick = () => {}, active, children, ...rest }) {
  const { close } = useContext(DropdownContext)
  return (
    <button
      type='button'
      className={`dropdown-item ${active ? 'active' : ''}`}
      onClick={(event) => {
        onClick(event)
        close()
      }}
      {...rest}
    >
      {children}
    </button>
  )
}

// Namespace object so `<Dropdown.Item>` call sites only need their import
// changed.
export const Dropdown = { Item: DropdownItem }
