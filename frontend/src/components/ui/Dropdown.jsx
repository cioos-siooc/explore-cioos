import * as React from 'react'
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState
} from 'react'
import { createPortal } from 'react-dom'

import './dropdownStyles.css'

const DropdownContext = createContext({ close: () => {} })

// Replacement for react-bootstrap's DropdownButton + Dropdown.Item pair,
// emitting Bootstrap-compatible class names (.dropdown, .dropdown-toggle,
// .dropdown-menu, .dropdown-item) so existing overrides keep applying. The
// menu portals into document.body rather than sitting inside .dropdown: a
// couple of call sites (e.g. the Legend layers card) live inside a scrolling,
// transformed ancestor, which clips an in-place absolutely-positioned menu
// no matter its own position value. Positioning is computed from the
// toggle's bounding rect instead of relying on CSS containment.
// `title` is the toggle's *content*; `tooltip` is the HTML title attribute.
export function DropdownButton ({
  title,
  tooltip,
  className = '',
  size,
  variant,
  children
}) {
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      minWidth: rect.width
    })
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    function handleClickOutside (event) {
      if (
        !buttonRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const buttonClasses = [
    'btn',
    'dropdown-toggle',
    size && `btn-${size}`,
    variant && `btn-${variant}`
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={`dropdown ${className}`}>
      <button
        type='button'
        ref={buttonRef}
        className={buttonClasses}
        title={tooltip}
        aria-expanded={open}
        aria-haspopup='listbox'
        onClick={() => setOpen(!open)}
      >
        {title}
      </button>
      {open &&
        createPortal(
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            <div className='dropdown-menu show' ref={menuRef} style={menuStyle}>
              {children}
            </div>
          </DropdownContext.Provider>,
          document.body
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
