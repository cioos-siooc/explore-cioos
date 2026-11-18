import * as React from "react";

import "./segmentedToggleStyles.css";

// A handful of mutually exclusive choices, all visible, one click each.
export default function SegmentedToggle({
  options,
  value,
  onChange,
  label,
  className,
  "data-testid": testId,
}) {
  return (
    <div
      className={className ? `segmentedToggle ${className}` : "segmentedToggle"}
      role="group"
      aria-label={label}
      data-testid={testId}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          className={
            value === optionValue ? "toggleButton selected" : "toggleButton"
          }
          aria-pressed={value === optionValue}
          onClick={() => onChange(optionValue)}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          <span className="toggleLabel">{optionLabel}</span>
        </button>
      ))}
    </div>
  );
}
