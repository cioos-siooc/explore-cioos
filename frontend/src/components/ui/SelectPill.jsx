import React, { useId } from "react";
import { CaretDownFill } from "react-bootstrap-icons";

import "./selectPillStyles.css";

// Short captions ("Sort", "Group") so both pills fit one row at phone width.
// `options` is [{ id, label }]; `children` is an optional trailing segment
// inside the pill (SortSelect's direction toggle).
export default function SelectPill({
  label,
  value,
  options,
  onChange,
  children,
  "data-testid": testId,
}) {
  const id = useId();
  // A <select> is as wide as its longest option; the sizer under it carries
  // the selected label so the pills fit the row in French.
  const selected = options.find((option) => option.id === value);

  return (
    <span className="selectPill" data-testid={testId}>
      <label className="selectPillLabel" htmlFor={id}>
        {label}
      </label>
      {/* Drawn over the select's trailing padding so a click anywhere opens it. */}
      <span className="selectPillField">
        <span className="selectPillSizer" aria-hidden="true">
          {selected?.label}
        </span>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <CaretDownFill
          className="selectPillCaret"
          size={8}
          aria-hidden="true"
        />
      </span>
      {children}
    </span>
  );
}
