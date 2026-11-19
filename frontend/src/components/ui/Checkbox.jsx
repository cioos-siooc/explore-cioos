import * as React from "react";
import { useContext, useRef } from "react";
import {
  Checkbox as AriaCheckbox,
  TooltipTrigger,
  TooltipTriggerStateContext,
} from "react-aria-components";

import { TooltipBubble } from "./Tooltip.jsx";
import withTitle from "./withTitle.js";

const TitledCheckbox = withTitle(AriaCheckbox, "label");

// A label around a visually hidden input: the children (indicator and text)
// are the whole click target, and state is on the label as data-selected,
// data-indeterminate, data-focus-visible. `onChange` is handed the new state.
//
// `tooltip` describes the checkbox. It can't be a ui/Tooltip around it, whose
// trigger must itself be focusable: here focus is on the hidden input but the
// pointer is on the label, so each half opens the same tooltip.
export default function Checkbox({
  tooltip,
  tooltipDelay = 0,
  tooltipPlacement,
  ...props
}) {
  const labelRef = useRef(null);
  if (!tooltip) return <TitledCheckbox {...props} />;
  return (
    <TooltipTrigger delay={tooltipDelay} closeDelay={0}>
      <HoverOpensTooltip ref={labelRef} {...props} />
      <TooltipBubble placement={tooltipPlacement} triggerRef={labelRef}>
        {tooltip}
      </TooltipBubble>
    </TooltipTrigger>
  );
}

function HoverOpensTooltip(props) {
  const tooltip = useContext(TooltipTriggerStateContext);
  return (
    <TitledCheckbox
      {...props}
      onHoverStart={() => tooltip.open()}
      onHoverEnd={() => tooltip.close()}
    />
  );
}
