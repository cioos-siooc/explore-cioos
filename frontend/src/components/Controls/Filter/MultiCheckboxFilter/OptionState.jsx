import * as React from "react";
import { CheckSquare, Square, XSquare } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

// How every list filter row shows its include/exclude state, so the lists
// cannot drift apart on it.
export const optionStateClass = ({ isSelected, isExcluded }) =>
  `optionButton ${isSelected ? "selected" : ""} ${isExcluded ? "excluded" : ""}`;

export function OptionStateIcon({ isSelected, isExcluded }) {
  if (isSelected) return <CheckSquare />;
  return isExcluded ? <XSquare /> : <Square />;
}

// aria-checked can only say "included"; "mixed" would mean partially, so
// exclusion is announced as text instead.
export function ExcludedLabel({ isExcluded }) {
  const { t } = useTranslation();
  if (!isExcluded) return null;
  return (
    <span className="sr-only">{` (${t("filterOptionExcludedLabel")})`}</span>
  );
}
