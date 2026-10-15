import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "./plotlyGlobal.js";
import Plotly from "plotly.js/lib/core";
import sunburst from "plotly.js/lib/sunburst";
import createPlotlyComponent from "react-plotly.js/factory";
import frLocale from "plotly.js-locales/fr";

import { sunburstTrace } from "./taxonomy.js";

// The basic Plotly bundle the other plots use has no sunburst; this one is
// loaded on demand so only an OBIS page showing it pays for it.
Plotly.register([sunburst, frLocale]);
const Plot = createPlotlyComponent(Plotly);

// ColorBrewer "Paired", as obis.org's own sunburst uses.
const OBIS_COLORWAY = [
  "#a6cee3",
  "#1f78b4",
  "#b2df8a",
  "#33a02c",
  "#fb9a99",
  "#e31a1c",
  "#fdbf6f",
  "#ff7f00",
  "#cab2d6",
  "#6a3d9a",
  "#ffff99",
  "#b15928",
];

export default function TaxonomySunburst({ tree }) {
  const { t, i18n } = useTranslation();
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

  return (
    <Plot
      className="taxonomySunburst"
      data={data}
      layout={{
        sunburstcolorway: OBIS_COLORWAY,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        autosize: true,
        paper_bgcolor: "rgba(0,0,0,0)",
        font: { family: "Montserrat, system-ui, sans-serif" },
      }}
      config={{
        displaylogo: false,
        responsive: true,
        locale: i18n.language === "fr" ? "fr" : "en",
      }}
      useResizeHandler
      style={{ width: "100%", height: "100%" }}
    />
  );
}
