import React from 'react'
import { Download, Spinner } from 'react-bootstrap-icons'
import './styles.css'

export default function DownloadCTA({
  selectedCount = 0,
  isLoading = false,
  onClick,
  disabled = false,
  label = 'Download'
}) {
  const isDisabled = disabled || selectedCount === 0 || isLoading

  return (
    <button
      className={`downloadCtaButton ${isDisabled ? 'disabled' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={`${label} ${selectedCount} dataset${selectedCount !== 1 ? 's' : ''}`}
      title={isDisabled ? 'Select datasets to enable download' : label}
    >
      {isLoading && <Spinner size={16} className='downloadCtaSpinner' />}
      {!isLoading && <Download size={18} />}
      <span className='downloadCtaLabel'>{label}</span>
    </button>
  )
}
