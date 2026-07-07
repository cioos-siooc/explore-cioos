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
    <div className='funnelVisualization'>
      <div className='funnelStage all'>
        <span className='funnelLabel'>All</span>
        <span className='funnelCount'>{all}</span>
      </div>

      <ChevronRight className='funnelArrow' size={16} aria-hidden='true' />

      <div className='funnelStage filtered'>
        <span className='funnelLabel'>Filtered</span>
        <span className='funnelCount'>{filtered}</span>
        {filteredPercent > 0 && (
          <span className='funnelPercent'>{filteredPercent}%</span>
        )}
      </div>

      <ChevronRight className='funnelArrow' size={16} aria-hidden='true' />

      <div className={`funnelStage selected ${selected > 0 ? 'active' : ''}`}>
        <span className='funnelLabel'>Selected</span>
        <span className='funnelCount'>{selected}</span>
        {selectedPercent > 0 && (
          <span className='funnelPercent'>{selectedPercent}%</span>
        )}
      </div>
    </div>
  )
}
