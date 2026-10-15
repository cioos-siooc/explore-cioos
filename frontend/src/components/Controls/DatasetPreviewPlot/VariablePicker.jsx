import * as React from "react";
import { useTranslation } from "react-i18next";

import { DropdownButton } from "../../ui/Dropdown.jsx";
import { labelFor, shortLabelFor } from "../DatasetPreview/previewVariables.js";

/**
 * Which variables get a panel.
 *
 * Checkbox rows rather than Dropdown.Item, because Dropdown.Item closes the menu
 * on click and choosing several variables means the menu has to stay open. The
 * menu portals to document.body with its own max-height, so however many
 * variables a dataset has, the list scrolls there and never inside the modal.
 */
export default function VariablePicker({
  choices,
  panels,
  variablesByName,
  togglePanel,
  setPanels,
}) {
  const { t } = useTranslation();
  const allSelected = panels.length === choices.length;
  const title =
    panels.length === 1
      ? shortLabelFor(variablesByName.get(panels[0]))
      : t("datasetPreviewPlotVariablesSelected", { count: panels.length });

  return (
    <DropdownButton
      className="dropdownButtonLeft"
      title={<span className="dropdownToggleLabel">{title}</span>}
    >
      {choices.length === 0 && (
        <span className="dropdownEmptyNote">
          {t("datasetPreviewPlotNoVariables")}
        </span>
      )}
      {choices.map((variable) => (
        <label
          className="dropdown-item variablePickerRow"
          key={variable.columnName}
        >
          <input
            type="checkbox"
            checked={panels.includes(variable.columnName)}
            onChange={() => togglePanel(variable.columnName)}
          />
          <span className="variablePickerLabel">{labelFor(variable)}</span>
        </label>
      ))}
      {choices.length > 1 && (
        <>
          <hr />
          <button
            type="button"
            className="dropdown-item"
            onClick={() =>
              setPanels(
                allSelected
                  ? []
                  : choices.map((variable) => variable.columnName),
              )
            }
          >
            {allSelected
              ? t("datasetPreviewPlotSelectNone")
              : t("datasetPreviewPlotSelectAll")}
          </button>
        </>
      )}
    </DropdownButton>
  );
}
