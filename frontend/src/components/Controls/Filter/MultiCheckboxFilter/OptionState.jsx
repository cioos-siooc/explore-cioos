import * as React from "react";
import classNames from "classnames";
import {
  CheckSquare,
  SlashCircle,
  Square,
  XSquare,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { ToggleButton } from "../../../ui/Button.jsx";
import Checkbox from "../../../ui/Checkbox.jsx";

export const optionStateClass = ({ isSelected, isExcluded }) =>
  `optionButton ${isSelected ? "selected" : ""} ${isExcluded ? "excluded" : ""}`;

export function OptionStateIcon({ isSelected, isExcluded }) {
  if (isSelected) return <CheckSquare />;
  return isExcluded ? <XSquare /> : <Square />;
}

// A checkbox can only say "included"; "mixed" would mean partially, so
// exclusion is announced as text instead.
export function ExcludedLabel({ isExcluded }) {
  const { t } = useTranslation();
  if (!isExcluded) return null;
  return (
    <span className="sr-only">{` (${t("filterOptionExcludedLabel")})`}</span>
  );
}

// Extra props (data-*) go on the checkbox's label. `tooltip` describes it.
export function FilterOption({
  label,
  isSelected,
  isExcluded,
  isIndeterminate,
  onInclude,
  onExclude,
  excludeTipHighlight,
  className,
  title,
  tooltip,
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
    >
      <Checkbox
        className="optionToggle"
        isSelected={Boolean(isSelected)}
        isIndeterminate={Boolean(isIndeterminate)}
        onChange={() => onInclude()}
        title={title}
        tooltip={tooltip}
        tooltipDelay={150}
        {...checkboxProps}
      >
        {icon || (
          <OptionStateIcon isSelected={isSelected} isExcluded={isExcluded} />
        )}
        {children}
        <ExcludedLabel isExcluded={isExcluded} />
      </Checkbox>
      {onExclude && (
        <ToggleButton
          className="optionExclude"
          data-tip-highlight={excludeTipHighlight}
          isSelected={Boolean(isExcluded)}
          aria-label={`${t("filterOptionExcludeAction")}: ${label}`}
          title={t(
            isExcluded
              ? "filterOptionUnexcludeTitle"
              : "filterOptionExcludeTitle",
          )}
          onChange={() => onExclude()}
        >
          <SlashCircle aria-hidden="true" />
        </ToggleButton>
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
