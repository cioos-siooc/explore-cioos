import React from 'react'
import { ChevronRight } from 'react-bootstrap-icons'
import './styles.css'

export default function FunnelVisualization({
  all = 0,
  filtered = 0,
  selected = 0
}) {
  const filteredPercent = all > 0 ? Math.round((filtered / all) * 100) : 0
  const selectedPercent = filtered > 0 ? Math.round((selected / filtered) * 100) : 0

  return (
    <div className='funnelVisualization' role='region' aria-label='Dataset filter funnel'>
      <div className='funnelStage all'>
        <span className='funnelLabel'>All</span>
        <span className='funnelCount' aria-label={`${all} total dataset${all !== 1 ? 's' : ''}`}>
          {all}
        </span>
      </div>

      <ChevronRight className='funnelArrow' size={16} aria-hidden='true' />

      <div className='funnelStage filtered'>
        <span className='funnelLabel'>Filtered</span>
        <span className='funnelCount' aria-label={`${filtered} filtered dataset${filtered !== 1 ? 's' : ''}`}>
          {filtered}
        </span>
        {filteredPercent > 0 && (
          <span className='funnelPercent' aria-label={`${filteredPercent} percent`}>
            {filteredPercent}%
          </span>
        )}
      </div>

      <ChevronRight className='funnelArrow' size={16} aria-hidden='true' />

      <div className={`funnelStage selected ${selected > 0 ? 'active' : ''}`}>
        <span className='funnelLabel'>Selected</span>
        <span className='funnelCount' aria-label={`${selected} dataset${selected !== 1 ? 's' : ''} selected for download`}>
          {selected}
        </span>
        {selectedPercent > 0 && (
          <span className='funnelPercent' aria-label={`${selectedPercent} percent`}>
            {selectedPercent}%
          </span>
        )}
      </div>
    </div>
  )
}
