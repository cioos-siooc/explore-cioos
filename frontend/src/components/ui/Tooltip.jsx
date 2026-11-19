import * as React from "react";
import {
  Focusable,
  Tooltip as AriaTooltip,
  TooltipTrigger,
} from "react-aria-components";
import classNames from "classnames";

import "./tooltipStyles.css";

// The child is the trigger: it must take a ref and spread props onto a
// focusable element, which is what lets react-aria link the bubble to it
// (aria-describedby) and show it on keyboard focus as well as hover. Plain
// text carrying a tooltip goes in a TooltipTarget.
export default function Tooltip({
  content,
  placement = "bottom",
  delay = 0,
  children,
}) {
  if (!content) return children;
  return (
    <TooltipTrigger delay={delay} closeDelay={0}>
      <Focusable>{children}</Focusable>
      <TooltipBubble placement={placement}>{content}</TooltipBubble>
    </TooltipTrigger>
  );
}

// Rendered inside a TooltipTrigger; `triggerRef` positions it against an
// element other than the trigger (see ui/Checkbox).
export function TooltipBubble({ placement = "bottom", triggerRef, children }) {
  return (
    <AriaTooltip
      placement={placement}
      offset={6}
      className="cioosTooltip"
      triggerRef={triggerRef}
    >
      <div className="tooltip-inner">{children}</div>
    </AriaTooltip>
  );
}

// A focusable, unstyled stand-in for text that only explains itself.
export function TooltipTarget({ className, ...props }) {
  return (
    <button
      type="button"
      className={classNames("tooltipTarget", className)}
      {...props}
    />
  );
}
