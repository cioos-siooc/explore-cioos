import classNames from 'classnames'
import * as React from 'react'
import { Tooltip, OverlayTrigger } from 'react-bootstrap'
import { QuestionCircle } from 'react-bootstrap-icons'

export default function QuestionIconTooltip({
  tooltipText,
  tooltipPlacement,
  size,
  className = ''
}) {
  return (
    <OverlayTrigger
      key={tooltipText}
      placement={tooltipPlacement}
      overlay={<Tooltip>{tooltipText}</Tooltip>}
    >
      <QuestionCircle className={classNames('helpIcon', className)} color='#007bff' size={size} />
    </OverlayTrigger>
  )
}
