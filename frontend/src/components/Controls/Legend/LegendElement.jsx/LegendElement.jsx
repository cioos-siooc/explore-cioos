import React from "react"
import { capitalizeFirstLetter } from '../../../../utilities.js'
import './styles.css'

export default function LegendElement({ title = '', open, children }) {
  return (
    <div className='legendElement' title={capitalizeFirstLetter(title)}>
      {open && <div className='legendElementLabel'>{capitalizeFirstLetter(title)}</div>}
      {children}
    </div>
  )
}