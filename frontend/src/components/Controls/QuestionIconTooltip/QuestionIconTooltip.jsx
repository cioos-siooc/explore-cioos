import classNames from 'classnames'
import * as React from 'react'
import { QuestionCircle } from 'react-bootstrap-icons'
import Tooltip from '../../ui/Tooltip.jsx'

export default function QuestionIconTooltip({
  tooltipText,
  tooltipPlacement,
  size,
  className = ''
}) {
  return (
    <Tooltip
      key={tooltipText}
      placement={tooltipPlacement}
      content={tooltipText}
    >
      <QuestionCircle className={classNames('helpIcon', className)} color='#52A79B' size={size} />
    </Tooltip>
  )
}
