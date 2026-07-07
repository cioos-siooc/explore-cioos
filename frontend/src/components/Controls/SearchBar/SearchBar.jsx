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
    <div className='searchBarContainer'>
      <div className='searchBarWrapper'>
        <input
          type='text'
          className='searchBarInput'
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label='Search datasets'
        />
        {value && (
          <button
            className='searchBarClearButton'
            onClick={onClear}
            aria-label='Clear search'
            title='Clear search'
          >
            <XCircle size={18} />
          </button>
        )}
      </div>
      {activeFilterCount > 0 && (
        <div className='filterCountBadge'>
          {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} active
        </div>
      )}
    </div>
  )
}
