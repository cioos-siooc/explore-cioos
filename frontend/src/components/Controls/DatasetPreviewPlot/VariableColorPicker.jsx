import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Dropdown, PopoverButton } from "../../ui/Dropdown.jsx";
import { SWATCHES } from "../DatasetPreview/previewColors.js";

// `color` is the override (null when drawing in `defaultColor`).
//
// The custom field is debounced: onChange on <input type="color"> fires on every
// pointer move in the OS dialog, and each would rewrite the URL and re-plot. It
// stays open while dragged, so it is a field beside the options, not one.
const COMMIT_DELAY_MS = 250;

export default function VariableColorPicker({
  color,
  defaultColor,
  onPick,
  label,
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const inUse = draft || color || defaultColor;

  const pick = (value) => {
    clearTimeout(timer.current);
    setDraft(null);
    onPick(value);
  };

  const drag = (value) => {
    setDraft(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onPick(value), COMMIT_DELAY_MS);
  };

  return (
    <PopoverButton
      className="dropdownButtonSwatch"
      align="center"
      tooltip={label}
      aria-label={label}
      title={
        <span
          className="colorSwatch"
          style={{ backgroundColor: inUse }}
          aria-hidden="true"
        />
      }
    >
      {({ close }) => (
        <>
          <div className="colorSwatchGrid">
            {SWATCHES.map((hex) => (
              <Dropdown.Option
                key={hex}
                isSelected={inUse === hex}
                onChange={() => {
                  pick(hex);
                  close();
                }}
                aria-label={hex}
              >
                <span
                  className="colorSwatch"
                  style={{ backgroundColor: hex }}
                  aria-hidden="true"
                />
              </Dropdown.Option>
            ))}
          </div>
          <hr />
          <Dropdown.Option
            isSelected={!color}
            onChange={() => {
              pick(null);
              close();
            }}
          >
            <span
              className="colorSwatch"
              style={{ backgroundColor: defaultColor }}
              aria-hidden="true"
            />
            {t("datasetPreviewPlotColorDefault")}
          </Dropdown.Option>
          <label className="colorSwatchCustom">
            {t("datasetPreviewPlotColorCustom")}
            <input
              type="color"
              value={inUse}
              onChange={(event) => drag(event.target.value)}
            />
          </label>
        </>
      )}
    </PopoverButton>
  );
}
