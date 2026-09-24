import * as React from "react";

import { useTips } from "../../state/tips/TipsProvider.jsx";
import "./switchStyles.css";

// Replacement for react-bootstrap's <Form.Check type='switch'>.
//
// `title` is the hover tooltip, and it doubles as the accessible name when the
// switch is rendered without a visible label — as in the legend's ramp title
// row, where the ramp's own caption says what the switch turns off.
// `tipTarget` names the contextual tip that points at it (see TipsProvider).
export default function Switch({
  id,
  label,
  title,
  checked,
  disabled,
  onChange,
  "data-testid": testId,
  tipTarget,
}) {
  const { tipHighlight } = useTips();
  return (
    <div
      className="form-check form-switch"
      data-tip-highlight={tipHighlight(tipTarget)}
    >
      <input
        className="form-check-input"
        data-testid={testId}
        type="checkbox"
        role="switch"
        id={id}
        title={title}
        aria-label={label ? undefined : title}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      {label && (
        <label className="form-check-label" htmlFor={id}>
          {label}
        </label>
      )}
    </div>
  );
}
