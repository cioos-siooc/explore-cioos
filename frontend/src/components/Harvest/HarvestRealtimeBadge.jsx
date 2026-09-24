import React from "react";
import { useTranslation } from "react-i18next";

// Surfaces dataset_is_realtime (database/8_range_functions.sql) — the same
// "still producing data" signal as the map's Real-time badge — so a dead
// real-time feed shows up from the harvest log, not only on the dataset cards.
export default function HarvestRealtimeBadge({ isRealtime }) {
  const { t } = useTranslation();
  if (!isRealtime) return null;

  return (
    <span className="harvest-realtime-badge" title={t("harvest.realtime.tip")}>
      {t("harvest.realtime.label")}
    </span>
  );
}
