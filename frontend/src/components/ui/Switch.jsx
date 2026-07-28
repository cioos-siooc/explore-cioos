import * as React from 'react'

import './switchStyles.css'

// Replacement for react-bootstrap's <Form.Check type='switch'>.
export default function Switch ({ id, label, checked, disabled, onChange }) {
  return (
    <div className='form-check form-switch'>
      <input
        className='form-check-input'
        type='checkbox'
        role='switch'
        id={id}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label && (
        <label className='form-check-label' htmlFor={id}>
          {label}
        </label>
      )}
    </div>
  )
}
