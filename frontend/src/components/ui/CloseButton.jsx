import * as React from "react";
import { X } from "react-bootstrap-icons";

import Button from "./Button.jsx";

import "./closeButtonStyles.css";

// The one way out of anything dismissable, so "this closes" is learned once.
// `icon` swaps the X for a window control (the sidebar's widen and narrow).
export default function CloseButton({
  label,
  onClick,
  icon: Icon = X,
  testId,
}) {
  return (
    <Button
      className="closeButton"
      data-testid={testId}
      onPress={onClick}
      title={label}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
