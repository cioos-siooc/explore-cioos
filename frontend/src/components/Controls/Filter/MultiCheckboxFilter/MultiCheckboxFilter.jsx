import * as React from "react";
import {
  CheckSquare,
  CircleFill,
  DashSquare,
  Square,
  XSquare,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import Checkbox from "../../../ui/Checkbox.jsx";
import {
  filterOptionLabel,
  toggleOptionExcluded,
  toggleOptionIncluded,
  withCategoryState,
} from "../../../../utilities";
import { platformColor } from "../../../../platformVocab.js";
import { FilterOption } from "./OptionState.jsx";
import { useTips } from "../../../../state/tips/TipsProvider.jsx";
import "./styles.css";

export default function MultiCheckboxFilter({
  optionsSelected,
  setOptionsSelected,
  translatable,
  colored,
  grouped,
  allOptions,
}) {
  const { t, i18n } = useTranslation();
  const { tipHighlight } = useTips();

  const labelOf = (option) =>
    filterOptionLabel(option, translatable, t, i18n.language);
  // Labelled once up front: a comparator would relabel each option log n times.
  const labels = new Map(optionsSelected.map((o) => [o, labelOf(o)]));
  // Copy first: optionsSelected is caller state and sort mutates in place.
  const optionsSelectedSorted = [...optionsSelected].sort((a, b) =>
    labels.get(a).localeCompare(labels.get(b), i18n.language),
  );

  // An empty selection means "all": short URLs, and newly harvested options
  // are included automatically rather than missing from a frozen list.
  const universe = allOptions || optionsSelected;
  const isChecked = (option) => option.isSelected;

  function updateOption(option, toggle) {
    setOptionsSelected(
      universe.map((opt) => (opt.pk === option.pk ? toggle(opt) : opt)),
    );
  }

  function setCategory(category, state) {
    setOptionsSelected(withCategoryState(universe, category, state));
  }

  function selectAllSearchResultsToggle() {
    const listOfPKs = optionsSelected.map((option) => option.pk);
    const allShownChecked = optionsSelected.every(isChecked);
    setOptionsSelected(
      universe.map((option) =>
        listOfPKs.includes(option.pk)
          ? { ...option, isSelected: !allShownChecked, isExcluded: false }
          : option,
      ),
    );
  }

  const categoryLabel = (option) => option.categoryTranslated[i18n.language];

  function groupByCategory(options) {
    const groups = new Map();
    for (const option of options) {
      if (!groups.has(option.category)) groups.set(option.category, []);
      groups.get(option.category).push(option);
    }
    return [...groups].sort(([, [a]], [, [b]]) =>
      categoryLabel(a).localeCompare(categoryLabel(b), i18n.language),
    );
  }

  function renderCategoryRow(category, label) {
    const members = universe.filter((opt) => opt.category === category);
    const allSelected = members.every(isChecked);
    const allExcluded = members.every((opt) => opt.isExcluded);
    const someSet = members.some((opt) => opt.isSelected || opt.isExcluded);
    return (
      <FilterOption
        className="optionGroupButton"
        label={label}
        isSelected={allSelected}
        isExcluded={allExcluded}
        onInclude={() =>
          setCategory(category, {
            isSelected: !allSelected,
            isExcluded: false,
          })
        }
        onExclude={() =>
          setCategory(category, {
            isSelected: false,
            isExcluded: !allExcluded,
          })
        }
        icon={
          allSelected ? (
            <CheckSquare />
          ) : allExcluded ? (
            <XSquare />
          ) : someSet ? (
            <DashSquare />
          ) : (
            <Square />
          )
        }
        isIndeterminate={!allSelected && someSet && !allExcluded}
        data-testid="filter-option-group"
      >
        <span className="optionName">{label}</span>
      </FilterOption>
    );
  }

  function renderOption(option, isFirst) {
    const title = labels.get(option);

    const swatchColor = colored && platformColor(option.title);
    const hoverText = option[`hover_${i18n.language}`] || title;

    return (
      <FilterOption
        key={option.pk}
        label={title}
        isSelected={option.isSelected}
        isExcluded={option.isExcluded}
        onInclude={() => updateOption(option, toggleOptionIncluded)}
        onExclude={() => updateOption(option, toggleOptionExcluded)}
        excludeTipHighlight={tipHighlight(isFirst && "exclude")}
        tooltip={hoverText}
        data-testid="filter-option"
        data-option-pk={option.pk}
        data-excluded={Boolean(option.isExcluded)}
      >
        <span className="optionName">{title}</span>
        {colored && (
          <CircleFill
            className="optionColorCircle"
            fill={swatchColor}
            size="15"
          />
        )}
      </FilterOption>
    );
  }

  return (
    <div className={"multiCheckboxFilter"}>
      {optionsSelected.length > 0 &&
        optionsSelected.length !== allOptions.length && (
          <>
            <Checkbox
              className="searchResultsButton"
              isSelected={optionsSelected.every(isChecked)}
              data-testid="filter-select-all-results"
              onChange={() => selectAllSearchResultsToggle()}
            >
              {optionsSelected.every(isChecked) ? <CheckSquare /> : <Square />}
              {t("multiCheckboxFilterSelectSearchResults")}{" "}
              {`(${optionsSelected.length})`}
            </Checkbox>
            <hr />
          </>
        )}
      {optionsSelected.length === 0 ? (
        <div>{t("multiCheckboxFilterNoFilterWarning")}</div>
      ) : grouped ? (
        groupByCategory(optionsSelectedSorted).map(([category, options], g) => (
          <div
            key={category}
            className="optionGroup"
            role="group"
            aria-label={categoryLabel(options[0])}
          >
            {renderCategoryRow(category, categoryLabel(options[0]))}
            <div className="optionGroupChildren">
              {options.map((option, i) =>
                renderOption(option, g === 0 && i === 0),
              )}
            </div>
          </div>
        ))
      ) : (
        optionsSelectedSorted.map((option, i) => renderOption(option, i === 0))
      )}
    </div>
  );
}
