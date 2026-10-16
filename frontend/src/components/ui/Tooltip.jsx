import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./tooltipStyles.css";

const GAP = 6;

// Attaches handlers to its single child (no wrapper) and portals the bubble.
export default function Tooltip({
  content,
  placement = "bottom",
  delay = 0,
  children,
}) {
  const [rect, setRect] = useState(null);
  const timer = useRef();

  useEffect(() => () => clearTimeout(timer.current), []);

  const child = React.Children.only(children);

  if (!content) return child;

  function show(event) {
    const targetRect = event.currentTarget.getBoundingClientRect();
    clearTimeout(timer.current);
    if (delay) {
      timer.current = setTimeout(() => setRect(targetRect), delay);
    } else {
      setRect(targetRect);
    }
  }

  function hide() {
    clearTimeout(timer.current);
    setRect(null);
  }

  const cloned = React.cloneElement(child, {
    onMouseEnter: (event) => {
      show(event);
      child.props.onMouseEnter?.(event);
    },
    onMouseLeave: (event) => {
      hide();
      child.props.onMouseLeave?.(event);
    },
    onFocus: (event) => {
      show(event);
      child.props.onFocus?.(event);
    },
    onBlur: (event) => {
      hide();
      child.props.onBlur?.(event);
    },
  });

  let style;
  if (rect) {
    // Side placements align to the near edge rather than centring: a
    // translated box can't be kept in the viewport without knowing its height.
    const verticalAnchor =
      rect.top + rect.height / 2 > window.innerHeight / 2
        ? { bottom: window.innerHeight - rect.bottom }
        : { top: rect.top };

    switch (placement) {
      case "top":
        style = {
          left: rect.left + rect.width / 2,
          top: rect.top - GAP,
          transform: "translate(-50%, -100%)",
        };
        break;
      case "right":
        style = { left: rect.right + GAP, ...verticalAnchor };
        break;
      case "left":
        // `right`, not `left` + a -100% translate: near the viewport edge the
        // box shrink-to-fit into a few pixels and max-width never applied.
        style = {
          right: window.innerWidth - rect.left + GAP,
          ...verticalAnchor,
        };
        break;
      case "bottom":
      default:
        style = {
          left: rect.left + rect.width / 2,
          top: rect.bottom + GAP,
          transform: "translateX(-50%)",
        };
        break;
    }
  }

  return (
    <>
      {cloned}
      {rect &&
        createPortal(
          <div className="cioosTooltip" role="tooltip" style={style}>
            <div className="tooltip-inner">{content}</div>
          </div>,
          document.body,
        )}
    </>
  );
}
