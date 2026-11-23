import React from "react";
import { X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import isEmpty from "lodash-es/isEmpty";

import Tooltip from "../../../ui/Tooltip.jsx";
import "./styles.css";
import { ToggleButton } from "../../../ui/Button.jsx";

export default function FilterButton({
  setOptionsSelected,
  optionsSelected,
  option,
}) {
  const { t, i18n } = useTranslation();
  if (!option) return null;
  const tooltipText = option[`hover_${i18n.language}`] || option.title;

  const filterOptionSelected = !isEmpty(
    optionsSelected.filter((opt) => option.pk === opt.pk && opt.isSelected),
  );

  return (
    <Tooltip placement="bottom" delay={150} content={tooltipText}>
      <ToggleButton
        className={`filterButton ${filterOptionSelected && "selected"}`}
        data-testid="filter-option"
        data-option-pk={option.pk}
        data-selected={filterOptionSelected}
        isSelected={filterOptionSelected}
        onChange={() => {
          setOptionsSelected(
            optionsSelected.map((opt) => {
              if (option.pk === opt.pk) {
                return {
                  ...opt,
                  isSelected: !opt.isSelected,
                };
              } else return opt;
            }),
          );
        }}
      >
        {t(option.title)}
        {filterOptionSelected && <X size="25" color="darkgrey" />}
      </ToggleButton>
    </Tooltip>
  );
}
