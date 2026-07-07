import React from 'react'
import { XCircle } from 'react-bootstrap-icons'
import './styles.css'

export default function FilterChips({
  activeFilters = [],
  onRemoveFilter,
  onClearAll
}) {
  if (activeFilters.length === 0) {
    return null
  }

  return (
    <div className='filterChipsContainer' role='region' aria-label='Active filters'>
      <div className='filterChipsWrapper'>
        {activeFilters.map((filter, index) => (
          <div key={index} className='filterChip' role='button' tabIndex={0}>
            <span className='chipLabel'>{filter}</span>
            <button
              className='chipRemoveButton'
              onClick={() => onRemoveFilter(index)}
              aria-label={`Remove filter: ${filter}`}
              title={`Remove ${filter}`}
            >
              <XCircle size={14} aria-hidden='true' />
            </button>
          </div>
        ))}
      </div>
      {activeFilters.length > 0 && (
        <button
          className='clearAllFiltersButton'
          onClick={onClearAll}
          aria-label={`Clear all ${activeFilters.length} active filter${activeFilters.length !== 1 ? 's' : ''}`}
          title='Clear all filters'
        >
          Clear all
        </button>
      )}
    </div>
  )
}
