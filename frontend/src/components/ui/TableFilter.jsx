import * as React from "react";
import { Search, X } from "react-bootstrap-icons";
import { Input, SearchField } from "react-aria-components";

import Button from "./Button.jsx";

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

// Escape clears it, as does the X once there is text to clear.
export default function TableFilter({ value, onChange, placeholder }) {
  return (
    <SearchField
      className="tableFilterWrap"
      value={value}
      onChange={onChange}
      aria-label={placeholder}
    >
      <Search size={13} aria-hidden="true" />
      <Input className="tableFilterInput" placeholder={placeholder} />
      <Button className="tableFilterClear">
        <X size={14} aria-hidden="true" />
      </Button>
    </SearchField>
  );
}
