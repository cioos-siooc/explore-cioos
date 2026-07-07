import React from 'react'
import { XCircle } from 'react-bootstrap-icons'
import './styles.css'

export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search datasets...',
  onClear,
  activeFilterCount = 0
}) {
  return (
    <div className='searchBarContainer' role='search'>
      <div className='searchBarWrapper'>
        <input
          type='text'
          className='searchBarInput'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label='Search datasets by title, type, or source'
          aria-describedby={activeFilterCount > 0 ? 'filter-status' : undefined}
        />
        {value && (
          <button
            className='searchBarClearButton'
            onClick={onClear}
            aria-label='Clear search'
            title='Clear search'
          >
            <XCircle size={18} aria-hidden='true' />
          </button>
        )}
      </div>
      {activeFilterCount > 0 && (
        <div className='filterCountBadge' id='filter-status' role='status'>
          {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
        </div>
      )}
    </div>
  )
}
