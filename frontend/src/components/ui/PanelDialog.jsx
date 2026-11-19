import * as React from "react";
import { useRef } from "react";
import { FocusScope, mergeProps, useDialog, useKeyboard } from "react-aria";

// A dialog that sits in the page rather than over it: no backdrop, the page
// stays usable. Opening takes focus, Escape closes it, and closing hands focus
// back to where it was. Closed, it is a plain element, so a panel that stays
// mounted for its exit transition doesn't hold or steal focus.
export default function PanelDialog({ isOpen, onClose, ...props }) {
  if (!isOpen) {
    const { "aria-label": _label, ...rest } = props;
    return <div {...rest} />;
  }
  return (
    <FocusScope restoreFocus>
      <OpenPanel onClose={onClose} {...props} />
    </FocusScope>
  );
}

function OpenPanel({ onClose, children, ...props }) {
  const ref = useRef(null);
  const { dialogProps } = useDialog(props, ref);
  const { keyboardProps } = useKeyboard({
    onKeyDown: (event) => {
      if (event.key === "Escape") onClose();
      else event.continuePropagation();
    },
  });
  return (
    <div ref={ref} {...mergeProps(props, dialogProps, keyboardProps)}>
      {children}
    </div>
  );
}
