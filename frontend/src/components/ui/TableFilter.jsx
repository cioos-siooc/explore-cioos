import * as React from "react";
import { Search } from "react-bootstrap-icons";

import "./tableFilterStyles.css";

// Case-insensitive substring filter across every value of each row.
export function filterRows(rows, filterText) {
  if (!filterText) return rows;
  const query = filterText.toLowerCase();
  return (rows || []).filter((row) =>
    Object.values(row)
      .filter((value) => value != null)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

export default function TableFilter({ value, onChange, placeholder }) {
  return (
    <label className="tableFilterWrap">
      <Search size={13} aria-hidden="true" />
      <input
        className="tableFilterInput"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
