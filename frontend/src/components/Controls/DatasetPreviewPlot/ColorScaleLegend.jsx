import React from "react";

// The colour dimension's scale, drawn beside the plot rather than inside it.
//
// Plotly's own colourbar sat at the right edge of the FIGURE, and a profile with
// many panels is wider than its pane — so on exactly the plots that need a third
// dimension, the bar was past the end of a horizontal scroll. This lives above
// the scroller and never moves.
//
// Everything it paints comes from buildFigure's `colorLegend`: the same stops the
// markers were given and the same range they were mapped over.

const gradientFrom = (stops) =>
  `linear-gradient(to right, ${stops
    .map(([position, color]) => `${color} ${Math.round(position * 100)}%`)
    .join(", ")})`;

// The first and last tick would hang off the ends of the ramp if they were
// centred on their position like the ones between them.
const alignmentAt = (index, count) => {
  if (index === 0) return "start";
  return index === count - 1 ? "end" : "mid";
};

export default function ColorScaleLegend({ legend }) {
  if (!legend || !legend.stops.length) return null;

  return (
    <div className="colorScaleLegend">
      <div className="colorScaleLegendLabel">{legend.label}</div>
      <div
        className="colorScaleLegendBar"
        style={{ backgroundImage: gradientFrom(legend.stops) }}
        aria-hidden="true"
      />
      <div className="colorScaleLegendTicks">
        {legend.ticks.map((tick, index) => (
          <span
            key={tick.text}
            className={`colorScaleLegendTick ${alignmentAt(
              index,
              legend.ticks.length,
            )}`}
            style={{ left: `${tick.position * 100}%` }}
          >
            {tick.text}
          </span>
        ))}
      </div>
    </div>
  );
}
