import * as React from "react";
import { useTranslation } from "react-i18next";

// The label Map.jsx pins over a clicked point: the figure and its source
// only. Datum and the not-for-navigation caveat live in the legend's ⓘ.
export default function DepthProbe({ reading }) {
  const { t, i18n } = useTranslation();
  const { pending, depth, resolution, source } = reading;

  if (pending) {
    return (
      <div className="depthProbe depthProbeQuiet" data-testid="depth-probe">
        {t("depthReadingPending")}
      </div>
    );
  }
  if (depth === null) {
    return (
      <div className="depthProbe depthProbeQuiet" data-testid="depth-probe">
        {t("depthReadingNone")}
      </div>
    );
  }

  const format = (metres) =>
    metres.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  // Above the datum: ground NONNA's survey saw dry at low tide, or ETOPO's
  // land.
  const above = depth < 0;
  const aboveKey =
    source === "etopo" ? "depthProbeElevation" : "depthProbeDries";
  return (
    <div className="depthProbe" data-testid="depth-probe">
      <div className="depthProbeValue">
        {above
          ? t(aboveKey, { height: format(-depth) })
          : t("depthProbeDepth", { depth: format(depth) })}
      </div>
      <div className="depthProbeSource">
        {t(source === "etopo" ? "depthProbeSourceEtopo" : "depthProbeSource", {
          resolution,
        })}
      </div>
    </div>
  );
}
