import React from "react";
import { useTranslation } from "react-i18next";
import { harvestMode } from "./harvestMode.js";

// 'file': ERDDAP isn't re-queried when the file list is unchanged; 'source':
// always re-queried. Empty when file detection didn't resolve.
export default function HarvestModeBadge({ dataset }) {
  const { t } = useTranslation();
  const mode = harvestMode(dataset);
  if (mode === "unknown") return null;

  const tip = t(`harvest.mode.${mode}.tip`);
  return (
    <span className="harvest-text-sm" title={tip}>
      {t(`harvest.mode.${mode}.label`)}
    </span>
  );
}
