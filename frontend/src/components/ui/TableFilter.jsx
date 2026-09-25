import * as React from "react";
import { Search } from "react-bootstrap-icons";

import "./tableFilterStyles.css";

// Case-insensitive substring filter across every value of each row. Used
// with DataTable to replace the search box react-data-table-component-
// extensions used to provide.
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

// The search box every list in the app shares — the datasets list, a dataset
// page's records, a record's preview table — so each looks and behaves alike.
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
