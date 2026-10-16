import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AttributionControl, ScaleControl } from "maplibre-gl";
import { InfoCircle } from "react-bootstrap-icons";

import { useMapState } from "../../../state/map/MapStateProvider.jsx";

// Re-parents MapLibre's own scale and attribution controls into the legend card,
// so they keep redrawing and aggregating sources added after mount.
export default function LegendFooter() {
  const { t } = useTranslation();
  const { mapInstance } = useMapState();
  const scaleHost = useRef(null);
  const creditsHost = useRef(null);
  const [creditsOpen, setCreditsOpen] = useState(false);

  // onAdd/onRemove is the whole IControl contract, so calling it ourselves (not
  // map.addControl, which would put them in a corner) is how to choose the parent.
  useEffect(() => {
    const map = mapInstance;
    if (!map || !scaleHost.current || !creditsHost.current) return;

    // Capped short: it shares a row with the ⓘ in a card at most 190px wide.
    const scale = new ScaleControl({ maxWidth: 120, unit: "metric" });
    scaleHost.current.appendChild(scale.onAdd(map));

    // compact: false keeps it expanded; its own <summary> toggle is hidden in CSS
    // because the ⓘ button is the disclosure, and two toggles would fight.
    const credits = new AttributionControl({ compact: false });
    creditsHost.current.appendChild(credits.onAdd(map));

    return () => {
      scale.onRemove();
      credits.onRemove();
    };
  }, [mapInstance]);

  return (
    <div className="legendFooter">
      <div className="legendFooterRow">
        <div className="legendScale" ref={scaleHost} />
        <button
          className="legendCreditsButton"
          onClick={() => setCreditsOpen(!creditsOpen)}
          title={t("legendCreditsTooltip")}
          aria-label={t("legendCreditsTooltip")}
          aria-expanded={creditsOpen}
        >
          <InfoCircle size={13} aria-hidden="true" />
        </button>
      </div>
      {/* Always mounted: a host that came and went would need re-adopting on every
          press of the ⓘ. */}
      <div className="legendCredits" ref={creditsHost} hidden={!creditsOpen} />
    </div>
  );
}
