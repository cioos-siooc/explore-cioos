import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import './tooltipStyles.css'

const GAP = 6

// Hover/focus tooltip replacing react-bootstrap's OverlayTrigger + Tooltip
// pair: <Tooltip content={...} placement='bottom'><button/></Tooltip>.
// Attaches handlers to its single child (no extra wrapper element) and
// renders the bubble in a portal positioned off the child's rect.
export default function Tooltip ({
  content,
  placement = 'bottom',
  delay = 0,
  children
}) {
  const [rect, setRect] = useState(null)
  const timer = useRef()

  useEffect(() => () => clearTimeout(timer.current), [])

  const child = React.Children.only(children)

  if (!content) return child

  function show (event) {
    const targetRect = event.currentTarget.getBoundingClientRect()
    clearTimeout(timer.current)
    if (delay) {
      timer.current = setTimeout(() => setRect(targetRect), delay)
    } else {
      setRect(targetRect)
    }
  }

  function hide () {
    clearTimeout(timer.current)
    setRect(null)
  }

  const cloned = React.cloneElement(child, {
    onMouseEnter: (event) => {
      show(event)
      child.props.onMouseEnter?.(event)
    },
    onMouseLeave: (event) => {
      hide()
      child.props.onMouseLeave?.(event)
    },
    onFocus: (event) => {
      show(event)
      child.props.onFocus?.(event)
    },
    onBlur: (event) => {
      hide()
      child.props.onBlur?.(event)
    }
  })

  let style
  if (rect) {
    // The side placements grow away from whichever horizontal half the trigger
    // sits in, aligned to its near edge rather than centred on it. Centring
    // needs a translate, and a translated box can't be kept inside the
    // viewport without knowing its own height — which is how a trigger in a
    // bottom corner used to push a multi-line bubble off the screen.
    const verticalAnchor =
      rect.top + rect.height / 2 > window.innerHeight / 2
        ? { bottom: window.innerHeight - rect.bottom }
        : { top: rect.top }

    switch (placement) {
    case 'top':
      style = {
        left: rect.left + rect.width / 2,
        top: rect.top - GAP,
        transform: 'translate(-50%, -100%)'
      }
      break
    case 'right':
      style = { left: rect.right + GAP, ...verticalAnchor }
      break
    case 'left':
      // Positioned by `right` rather than `left` + a -100% translate: a box
      // offset from the left with only a few pixels of viewport beyond it
      // shrink-to-fits into those pixels, so every line wrapped and the
      // max-width never applied.
      style = { right: window.innerWidth - rect.left + GAP, ...verticalAnchor }
      break
    case 'bottom':
    default:
      style = {
        left: rect.left + rect.width / 2,
        top: rect.bottom + GAP,
        transform: 'translateX(-50%)'
      }
      break
    }
  }

  return (
    <>
      {cloned}
      {rect &&
        createPortal(
          <div className='cioosTooltip' role='tooltip' style={style}>
            <div className='tooltip-inner'>{content}</div>
          </div>,
          document.body
        )}
    </>
  )
}
