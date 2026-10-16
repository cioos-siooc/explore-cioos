import * as React from "react";
import { X } from "react-bootstrap-icons";

import "./closeButtonStyles.css";

// The one way out of anything dismissable, so "this closes" is learned once.
// `icon` is for the WMS legend's fold-back control beside its X.
export default function CloseButton({
  label,
  onClick,
  icon: Icon = X,
  testId,
}) {
  return (
    <button
      type="button"
      className="closeButton"
      data-testid={testId}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <Icon aria-hidden="true" />
    </button>
  );
}
