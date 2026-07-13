import * as React from 'react'

import './spinnerStyles.css'

// Drop-in replacement for react-bootstrap's border Spinner. Matches its
// behavior of only honouring size='sm' (numeric sizes were always ignored).
export default function Spinner ({ className = '', size, role = 'status' }) {
  const classes = [
    'spinner-border',
    size === 'sm' && 'spinner-border-sm',
    className
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={classes} role={role} aria-hidden='true'>
      <span className='sr-only' />
    </span>
  )
}
