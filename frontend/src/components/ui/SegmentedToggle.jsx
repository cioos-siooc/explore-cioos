import * as React from "react";
import classNames from "classnames";

import { ToggleButton, ToggleButtonGroup } from "./Button.jsx";
import "./segmentedToggleStyles.css";

// A handful of mutually exclusive choices, all visible, one press each: a
// radio group, walked with the arrow keys.
export default function SegmentedToggle({
  options,
  value,
  onChange,
  label,
  className,
  "data-testid": testId,
}) {
  return (
    <ToggleButtonGroup
      className={classNames("segmentedToggle", className)}
      aria-label={label}
      data-testid={testId}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => onChange([...keys][0])}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <ToggleButton
          key={optionValue}
          id={optionValue}
          className={classNames("toggleButton", {
            selected: value === optionValue,
          })}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          <span className="toggleLabel">{optionLabel}</span>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
