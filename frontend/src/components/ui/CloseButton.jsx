import * as React from "react";
import { X } from "react-bootstrap-icons";

import "./closeButtonStyles.css";

// The one way out of anything dismissable: every modal header, the datasets
// card and its dataset-page banner, the map's "what's here" card, the WMS
// legend. One size, one shape, one hover — "this closes" is a single thing to
// learn wherever it turns up — and a real target rather than a corner glyph,
// grown to a thumb's worth on touch.
//
// `icon` is for the one control that folds a card back rather than closing it
// (the WMS legend's, which sits beside its X): the same button doing a
// neighbouring job, and the reason it isn't a second hand-rolled one.
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
