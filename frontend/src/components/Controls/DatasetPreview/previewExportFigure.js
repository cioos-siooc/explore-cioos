// The figure the PNG download draws: the plot as it stands (zoom included), plus
// the two things the screen draws outside it — the pinned shared axis and the
// colour legend — put back inside, since an image has no strip beside it.

import cloneDeep from "lodash-es/cloneDeep.js";

import { COLUMNS } from "./previewFacetPlan.js";
import { COLORBAR_ROOM_PX, pinnedAxisSizeFor } from "./previewFacetSizing.js";
import {
  maxCharsFor,
  wrapLabel,
  LABEL_FONT_PX,
  TICK_FONT_PX,
} from "./previewLabelText.js";
import {
  COLORBAR_PAD_PX,
  COLORBAR_THICKNESS_PX,
} from "./previewFacetFigure.js";
import { pinnedAxisKeyFor } from "./previewPinnedAxis.js";

/**
 * @param data, layout the live graph's (`graphDiv.data` / `graphDiv.layout`);
 *   cloned, because Plotly writes back into whatever figure it is handed
 * @param pinnedAxis splitPinnedAxis's `axis`, or null for a grid, which
 *   pins nothing
 * @param colorLegend buildFigure's `colorLegend`, or null
 * @param colorLegends buildGridFigure's, one per colour axis; stacked beside
 *   the plot in the image
 */
export function exportFigureFor({
  data,
  layout,
  pinnedAxis,
  orientation,
  colorLegend,
  colorLegends = colorLegend ? [{ ...colorLegend, axis: "coloraxis" }] : [],
}) {
  const exported = { data: cloneDeep(data), layout: cloneDeep(layout) };
  const margin = { ...exported.layout.margin };
  let { width, height } = exported.layout;

  if (pinnedAxis) {
    const axisKey = pinnedAxisKeyFor(orientation);
    exported.layout[axisKey] = {
      ...exported.layout[axisKey],
      ...pinnedAxis,
      showticklabels: true,
    };
    // Room the strip had on screen, so the panels keep their size.
    const axisRoom = pinnedAxisSizeFor(orientation);
    if (orientation === COLUMNS) {
      margin.l += axisRoom;
      width += axisRoom;
    } else {
      margin.b += axisRoom;
      height += axisRoom;
    }
  }

  const drawn = colorLegends.filter(
    (legend) => exported.layout[legend.axis] && legend.ticks.length,
  );
  const plottingHeight = layout.height - layout.margin.t - layout.margin.b;
  drawn.forEach((colorLegend, index) => {
    const coloraxis = exported.layout[colorLegend.axis];
    const span = coloraxis.cmax - coloraxis.cmin;
    // Several bars share the edge, top to bottom in legend order.
    const share = 1 / drawn.length;
    exported.layout[colorLegend.axis] = {
      ...coloraxis,
      showscale: true,
      colorbar: {
        x: 1,
        xanchor: "left",
        xpad: COLORBAR_PAD_PX,
        ...(drawn.length > 1
          ? { y: 1 - (index + 0.5) * share, yanchor: "middle" }
          : {}),
        len: drawn.length > 1 ? share * 0.9 : 1,
        lenmode: "fraction",
        thickness: COLORBAR_THICKNESS_PX,
        tickfont: { size: TICK_FONT_PX },
        // The legend's own ticks, so the image reads like the screen.
        tickmode: "array",
        tickvals: colorLegend.ticks.map(
          (tick) => coloraxis.cmin + tick.position * span,
        ),
        ticktext: colorLegend.ticks.map((tick) => tick.text),
        title: {
          text: wrapLabel(
            colorLegend.label,
            maxCharsFor(plottingHeight / drawn.length),
          ),
          side: "right",
          font: { size: LABEL_FONT_PX },
        },
      },
    };
  });
  if (drawn.length) {
    margin.r += COLORBAR_ROOM_PX;
    width += COLORBAR_ROOM_PX;
  }

  exported.layout = { ...exported.layout, margin, width, height };
  return { ...exported, width, height };
}
