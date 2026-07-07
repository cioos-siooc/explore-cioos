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
    <div className='filterChipsContainer'>
      <div className='filterChipsWrapper'>
        {activeFilters.map((filter, index) => (
          <div key={index} className='filterChip'>
            <span className='chipLabel'>{filter}</span>
            <button
              className='chipRemoveButton'
              onClick={() => onRemoveFilter(index)}
              aria-label={`Remove filter: ${filter}`}
              title={`Remove ${filter}`}
            >
              <XCircle size={14} />
            </button>
          </div>
        ))}
      </div>
      {activeFilters.length > 0 && (
        <button
          className='clearAllFiltersButton'
          onClick={onClearAll}
          aria-label='Clear all filters'
          title='Clear all filters'
        >
          Clear all
        </button>
      )}
    </div>
  )
}
