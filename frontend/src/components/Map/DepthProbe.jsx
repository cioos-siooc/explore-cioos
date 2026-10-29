import * as React from "react";
import { useTranslation } from "react-i18next";

// The label Map.jsx pins over a clicked point: the figure and its source
// only. Datum and the not-for-navigation caveat live in the legend's ⓘ.
export default function DepthProbe({ reading }) {
  const { t, i18n } = useTranslation();
  const { depth, resolution, source } = reading;

  const format = (metres) =>
    metres.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  // Above the datum: ground NONNA's survey saw dry at low tide.
  const above = depth < 0;
  return (
    <div className="depthProbe" data-testid="depth-probe">
      <div className="depthProbeValue">
        {above
          ? t("depthProbeElevation", { height: format(-depth) })
          : t("depthProbeDepth", { depth: format(depth) })}
      </div>
      <div className="depthProbeSource">
        {t(source === "gebco" ? "depthProbeSourceGebco" : "depthProbeSource", {
          resolution,
        })}
      </div>
    </div>
  );
}
