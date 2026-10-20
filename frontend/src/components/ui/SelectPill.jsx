import React, { useId } from "react";
import { CaretDownFill } from "react-bootstrap-icons";

import "./selectPillStyles.css";

// Short captions ("Sort", "Group") so both pills fit one row at phone width.
// `options` is [{ id, label, group? }], consecutive options sharing a `group`
// rendered under one <optgroup>; `children` is an optional trailing segment
// inside the pill (SortSelect's direction toggle).
const renderOption = (option) => (
  <option key={option.id} value={option.id}>
    {option.label}
  </option>
);

function groupOptions(options) {
  const runs = [];
  for (const option of options) {
    const last = runs.at(-1);
    if (last && last.group === option.group) last.items.push(option);
    else runs.push({ group: option.group, items: [option] });
  }
  return runs;
}

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
          {groupOptions(options).map(({ group, items }) =>
            group ? (
              <optgroup key={group} label={group}>
                {items.map(renderOption)}
              </optgroup>
            ) : (
              items.map(renderOption)
            ),
          )}
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
