import * as React from "react";
import classNames from "classnames";
import {
  CheckSquare,
  SlashCircle,
  Square,
  XSquare,
} from "react-bootstrap-icons";
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

// One list filter row: the row includes the option, the button at its end
// excludes it. Two controls side by side rather than one cycling through three
// states, which had to be explained before anyone could use it. `label` names
// the option for the exclude button; extra props (data-*) go on the checkbox.
// The whole row takes the click, so the padding around the checkbox is a
// target too; the checkbox's own click bubbles up to it.
export function FilterOption({
  label,
  isSelected,
  isExcluded,
  onInclude,
  onExclude,
  className,
  title,
  icon,
  children,
  ...checkboxProps
}) {
  const { t } = useTranslation();
  return (
    <div
      className={classNames(
        optionStateClass({ isSelected, isExcluded }),
        className,
      )}
      title={title}
      onClick={onInclude}
    >
      <div
        className="optionToggle"
        role="checkbox"
        aria-checked={Boolean(isSelected)}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            // Space would otherwise scroll the pane out from under the row.
            event.preventDefault();
            onInclude();
          }
        }}
        {...checkboxProps}
      >
        {icon || (
          <OptionStateIcon isSelected={isSelected} isExcluded={isExcluded} />
        )}
        {children}
        <ExcludedLabel isExcluded={isExcluded} />
      </div>
      {onExclude && (
        <button
          type="button"
          className="optionExclude"
          aria-pressed={Boolean(isExcluded)}
          aria-label={`${t("filterOptionExcludeAction")}: ${label}`}
          title={t(
            isExcluded
              ? "filterOptionUnexcludeTitle"
              : "filterOptionExcludeTitle",
          )}
          onClick={(event) => {
            event.stopPropagation();
            onExclude();
          }}
        >
          <SlashCircle aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
