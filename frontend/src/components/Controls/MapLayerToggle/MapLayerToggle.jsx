import React from 'react'
import { Grid3x3Gap } from 'react-bootstrap-icons'
import classNames from 'classnames'

import './styles.css'

// Map-corner toggle for the griddap coverage layer (off by default). Follows
// the boxQueryButton pattern: a React button absolutely positioned over the
// map, above the navigation-control cluster.
export default function MapLayerToggle({ active, onToggle, title }) {
  return (
    <button
      className={classNames('mapLayerToggle', { active })}
      onClick={onToggle}
      title={title}
    >
      <Grid3x3Gap size='28px' color={active ? '#52a79b' : '#555555'} />
    </button>
  )
}
