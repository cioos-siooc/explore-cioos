import React from "react";
import { useTranslation } from "react-i18next";

import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import {
  COLOR_SCALES,
  swatchStopsFor,
} from "../DatasetPreview/previewColorScales.js";

// The ramp the colour dimension is drawn in. Shaped like VariableColorPicker
// beside it — a chip in the toggle, the offered set in the menu, and "back to
// what the dataset says" at the top — but a whole gradient rather than one
// colour, because this one IS the mapping and not a label for a panel.
//
// `value` is the OVERRIDE, null while the column is still drawing in the scale
// its own colorBarPalette implies; `autoName` is what that resolves to, so the
// default row can show the ramp it stands for rather than the word "default".

// cmocean's own names are KT_thermal, KT_haline …; the prefix is the .cpt file's
// author, not anything the reader needs.
const scaleLabel = (name) => name.replace(/^KT_/, "");

const gradientFor = (name) => {
  const stops = swatchStopsFor(name);
  if (!stops.length) return undefined;
  return `linear-gradient(to right, ${stops
    .map(([position, color]) => `${color} ${Math.round(position * 100)}%`)
    .join(", ")})`;
};

function ScaleChip({ name }) {
  return (
    <span
      className="colorScaleChip"
      style={{ backgroundImage: gradientFor(name) }}
      aria-hidden="true"
    />
  );
}

export default function ColorScalePicker({ value, autoName, onPick }) {
  const { t } = useTranslation();
  const inUse = value || autoName;

  return (
    <DropdownButton
      className="dropdownButtonLeft"
      menuClassName="colorScaleMenu"
      title={
        <span className="dropdownToggleLabel colorScaleLabel">
          <ScaleChip name={inUse} />
          {scaleLabel(inUse)}
        </span>
      }
    >
      <Dropdown.Item active={!value} onClick={() => onPick(null)}>
        <span className="colorScaleLabel">
          <ScaleChip name={autoName} />
          {t("datasetPreviewPlotColorDefault")}
        </span>
      </Dropdown.Item>
      <hr />
      {COLOR_SCALES.map((name) => (
        <Dropdown.Item
          key={name}
          active={value === name}
          onClick={() => onPick(name)}
        >
          <span className="colorScaleLabel">
            <ScaleChip name={name} />
            {scaleLabel(name)}
          </span>
        </Dropdown.Item>
      ))}
    </DropdownButton>
  );
}
