import React from "react";
import { CaretDownFill, CaretUpFill } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import SelectPill from "./SelectPill.jsx";
import "./sortSelectStyles.css";

// A select rather than a row of chips, which wrapped to several lines at
// phone width. `sort` is { field, dir }, the shape `onChange` is handed back.
export default function SortSelect({ fields, sort, onChange, label }) {
  const { t } = useTranslation();
  const ascending = sort.dir === "asc";
  const directionTitle = ascending
    ? t("datasetsCardSortAscendingTitle")
    : t("datasetsCardSortDescendingTitle");

  return (
    <SelectPill
      label={label ?? t("datasetsCardSortByLabel")}
      value={sort.field}
      options={fields}
      // Changing field keeps the direction.
      onChange={(field) => onChange({ field, dir: sort.dir })}
    >
      <button
        type="button"
        className="sortSelectDirection"
        onClick={() =>
          onChange({ field: sort.field, dir: ascending ? "desc" : "asc" })
        }
        title={directionTitle}
        aria-label={directionTitle}
      >
        {ascending ? (
          <CaretUpFill size={9} aria-hidden="true" />
        ) : (
          <CaretDownFill size={9} aria-hidden="true" />
        )}
      </button>
    </SelectPill>
  );
}
