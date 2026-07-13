import * as React from 'react'
import classNames from 'classnames'

// One item in the bottom dock: icon on top, label + live count below.
// `prominent` marks the primary action (Filters): larger and brand-colored.
export default function DockItem ({
  id,
  icon,
  label,
  count,
  countTitle,
  active,
  disabled,
  prominent,
  onClick
}) {
  return (
    <button
      type='button'
      id={`dockItem-${id}`}
      className={classNames('dockItem', { active, disabled, prominent })}
      aria-expanded={active}
      aria-controls={`panel-${id}`}
      disabled={disabled}
      onClick={onClick}
      title={countTitle}
    >
      <span className='dockItemIcon' aria-hidden='true'>
        {icon}
      </span>
      <span className='dockItemCaption'>
        <span className='dockItemLabel'>{label}</span>
        {count !== undefined && count !== null && (
          <span className='dockItemCount' aria-label={countTitle}>
            {count}
          </span>
        )}
      </span>
    </button>
  )
}
