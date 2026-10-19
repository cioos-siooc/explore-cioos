import React, { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./plotlyGlobal.js";
import Plotly from "plotly.js/lib/core";
import sunburst from "plotly.js/lib/sunburst";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import { OBIS_COLORWAY, SUNBURST_ROOT_ID, sunburstTrace } from "./taxonomy.js";

// The basic Plotly bundle the other plots use has no sunburst; this one is
// loaded on demand so only an OBIS page showing it pays for it.
Plotly.register([sunburst, frLocale]);
const Plot = createPlotlyComponent(Plotly);

// Plotly's own sector-click zoom, run in reverse back to the root.
const ZOOM_OUT = {
  frame: { redraw: false, duration: 750 },
  transition: { duration: 750, easing: "linear" },
  mode: "immediate",
  fromcurrent: true,
};

export default function TaxonomySunburst({ tree, actionsEl }) {
  const { t, i18n } = useTranslation();
  const graphRef = useRef(null);
  const [zoomed, setZoomed] = useState(false);
  const data = useMemo(() => {
    const trace = sunburstTrace(tree, t("taxonomyAllText"));
    return [
      {
        type: "sunburst",
        ids: trace.ids,
        labels: trace.labels,
        parents: trace.parents,
        values: trace.values,
        customdata: trace.ranks.map((rank) =>
          rank === "root" ? "" : t(`taxonRank_${rank}`),
        ),
        branchvalues: "total",
        leaf: { opacity: 1 },
        maxdepth: 4,
        hovertemplate: `<b>%{label}</b><br>${t("taxonomyRecordsText")}: %{value:,}<br>%{customdata}<extra></extra>`,
      },
    ];
  }, [tree, t]);

  function showAll() {
    Plotly.animate(
      graphRef.current,
      { data: [{ level: SUNBURST_ROOT_ID }], traces: [0] },
      ZOOM_OUT,
    );
    setZoomed(false);
  }

  const actions = (
    <button
      type="button"
      className="recordShowAll"
      disabled={!zoomed}
      onClick={showAll}
    >
      {t("taxonomyShowAllText")}
    </button>
  );

  return (
    <>
      {actionsEl ? createPortal(actions, actionsEl) : actions}
      <div className="taxonomySunburstFrame">
        <Plot
          className="taxonomySunburst"
          data={data}
          layout={{
            sunburstcolorway: OBIS_COLORWAY,
            extendsunburstcolors: false,
            margin: { l: 0, r: 0, t: 0, b: 0 },
            autosize: true,
            paper_bgcolor: "rgba(0,0,0,0)",
            font: { family: "Montserrat, system-ui, sans-serif" },
          }}
          config={{
            displayModeBar: false,
            responsive: true,
            locale: i18n.language === "fr" ? "fr" : "en",
          }}
          useResizeHandler
          style={{ width: "100%", height: "100%" }}
          onInitialized={(_, graphDiv) => {
            graphRef.current = graphDiv;
          }}
          // nextLevel is absent when a click doesn't zoom (a leaf, or the root).
          onSunburstClick={({ nextLevel }) => {
            if (nextLevel !== undefined) {
              setZoomed(Boolean(nextLevel) && nextLevel !== SUNBURST_ROOT_ID);
            }
          }}
        />
      </div>
    </>
  );
}
