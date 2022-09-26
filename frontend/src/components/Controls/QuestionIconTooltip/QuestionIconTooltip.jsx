import * as React from 'react'
import { Tooltip, OverlayTrigger } from 'react-bootstrap'
import { QuestionCircle } from 'react-bootstrap-icons'

export default function QuestionIconTooltip({
  tooltipText,
  tooltipPlacement,
  size
}) {
  return (
    <OverlayTrigger
      key={tooltipText}
      placement={tooltipPlacement}
      overlay={<Tooltip>{tooltipText}</Tooltip>}
    >
      <QuestionCircle className='helpIcon' color='#007bff' size={size} />
    </OverlayTrigger>
  )
}
