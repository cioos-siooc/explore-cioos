import * as React from 'react'
import { Search } from 'react-bootstrap-icons'

import './tableFilterStyles.css'

// Case-insensitive substring filter across every value of each row. Used
// with DataTable to replace the search box react-data-table-component-
// extensions used to provide.
export function filterRows (rows, filterText) {
  if (!filterText) return rows
  const query = filterText.toLowerCase()
  return (rows || []).filter((row) =>
    Object.values(row)
      .filter((value) => value != null)
      .join(' ')
      .toLowerCase()
      .includes(query)
  )
}

// Controlled search input styled like the DatasetsTable sidebar search.
export default function TableFilter ({ value, onChange, placeholder }) {
  return (
    <div className='tableFilterWrap'>
      <Search size={13} aria-hidden='true' />
      <input
        className='tableFilterInput'
        type='text'
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}
