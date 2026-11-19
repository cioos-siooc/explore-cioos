import * as React from "react";
import classNames from "classnames";
import {
  CheckSquare,
  SlashCircle,
  Square,
  XSquare,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

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

// Extra props (data-*) go on the checkbox; its click bubbles to the row.
export function FilterOption({
  label,
  isSelected,
  isExcluded,
  onInclude,
  onExclude,
  excludeTipHighlight,
  className,
  title,
  icon,
  children,
  ...checkboxProps
}) {
  const { t } = useTranslation();
  return (
    <div // eslint-disable-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- docs/frontend-ui-audit.md step 6: Checkbox
      className={classNames(
        optionStateClass({ isSelected, isExcluded }),
        className,
      )}
      title={title}
      onClick={onInclude}
    >
      <div
        className="optionToggle"
        role="checkbox" // eslint-disable-line no-restricted-syntax -- docs/frontend-ui-audit.md step 6: Checkbox
        aria-checked={Boolean(isSelected)}
        tabIndex={0}
        {...checkboxProps}
        onKeyDown={(event) => {
          // A wrapping Tooltip passes its own (Escape closes it).
          checkboxProps.onKeyDown?.(event);
          if (event.key === " " || event.key === "Enter") {
            // Space would otherwise scroll the pane out from under the row.
            event.preventDefault();
            onInclude();
          }
        }}
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
          data-tip-highlight={excludeTipHighlight}
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

// What a row's box and its trailing button do; shown under every list that
// can exclude.
export function OptionStateLegend() {
  const { t } = useTranslation();
  return (
    <p className="filterOptionsLegend" data-testid="filter-legend">
      <span className="optionLegendItem">
        <Square aria-hidden="true" />
        {t("filterLegendSelect")}
      </span>
      <span className="optionLegendItem">
        <SlashCircle aria-hidden="true" />
        {t("filterLegendExclude")}
      </span>
    </p>
  );
}
