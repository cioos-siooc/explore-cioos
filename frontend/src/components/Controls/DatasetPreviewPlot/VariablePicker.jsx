import * as React from "react";
import { useTranslation } from "react-i18next";
import Select, { components } from "react-select";
import { CaretDownFill } from "react-bootstrap-icons";

import MatchHighlight from "../../ui/MatchHighlight.jsx";
import { labelFor, shortLabelFor } from "../DatasetPreview/previewVariables.js";

const columnNameOf = (variable) => variable.columnName;

// The menu portals to document.body (the pane scrolls and the modal clips), so
// it needs the dropdown layer to show above the dialog.
const STYLES = {
  menuPortal: (base) => ({ ...base, zIndex: "var(--cioos-z-dropdown, 1060)" }),
};

// The cap note and Select all / Clear all ride along the option list, reading
// what they need from the extra props react-select hands through selectProps.
function MenuList(props) {
  const { capNote, bulkAction } = props.selectProps;
  return (
    <components.MenuList {...props}>
      {capNote && <span className="dropdownEmptyNote">{capNote}</span>}
      {props.children}
      {bulkAction && (
        <button
          type="button"
          className="dropdown-item variableSelectBulk"
          // Before the input blurs and closes the menu.
          onMouseDown={(event) => event.preventDefault()}
          onClick={bulkAction.run}
        >
          {bulkAction.label}
        </button>
      )}
    </components.MenuList>
  );
}

// The small filled caret the pane's other dropdowns and SelectPill draw, in
// place of react-select's 20px chevron and its separator rule.
function DropdownIndicator(props) {
  return (
    <components.DropdownIndicator {...props}>
      <CaretDownFill size={9} aria-hidden="true" />
    </components.DropdownIndicator>
  );
}

/**
 * Variables for one axis, typed to filter: one pill each, or a single pick
 * when `isMulti` is off. Unless `required`, the last pick can be removed, and a
 * single pick then falls back to `placeholder`.
 */
export default function VariablePicker({
  label,
  choices,
  value: selected,
  variablesByName,
  onChange,
  isMulti = true,
  required = false,
  placeholder,
  maxSelected = Infinity,
}) {
  const { t } = useTranslation();
  const selectable = Math.min(choices.length, maxSelected);
  const atCap = isMulti && selected.length >= maxSelected;
  const allSelected = selected.length === selectable;
  const options = selected
    .map((name) => variablesByName.get(name))
    .filter(Boolean);
  const locked = required && selected.length <= 1;

  return (
    <Select
      isMulti={isMulti}
      className="variableSelect"
      classNamePrefix="variableSelect"
      options={choices}
      value={isMulti ? options : (options[0] ?? null)}
      onChange={(picked) =>
        onChange(
          isMulti
            ? picked.map(columnNameOf)
            : picked
              ? [picked.columnName]
              : [],
        )
      }
      getOptionValue={columnNameOf}
      getOptionLabel={labelFor}
      formatOptionLabel={(variable, { context, inputValue }) =>
        context === "menu" ? (
          <MatchHighlight text={labelFor(variable)} query={inputValue} />
        ) : (
          shortLabelFor(variable)
        )
      }
      isOptionDisabled={() => atCap}
      closeMenuOnSelect={!isMulti}
      backspaceRemovesValue={!locked}
      isClearable={!isMulti && !required}
      placeholder={placeholder ?? t("datasetPreviewPlotSearchVariables")}
      aria-label={label}
      noOptionsMessage={({ inputValue }) =>
        t(
          inputValue
            ? "datasetPreviewPlotNoMatchingVariables"
            : choices.length === 0
              ? "datasetPreviewPlotNoVariables"
              : "datasetPreviewPlotAllVariablesSelected",
        )
      }
      menuPortalTarget={document.body}
      menuPosition="fixed"
      styles={STYLES}
      components={{
        MenuList,
        DropdownIndicator,
        IndicatorSeparator: null,
        ...(locked && { MultiValueRemove: () => null }),
      }}
      capNote={
        choices.length > maxSelected &&
        t("datasetPreviewPlotMaxVariables", { count: maxSelected })
      }
      bulkAction={
        isMulti &&
        !required &&
        choices.length > 1 && {
          label: t(
            allSelected
              ? "datasetPreviewPlotSelectNone"
              : "datasetPreviewPlotSelectAll",
          ),
          run: () =>
            onChange(
              allSelected ? [] : choices.slice(0, selectable).map(columnNameOf),
            ),
        }
      }
    />
  );
}
