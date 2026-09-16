import React, { useState } from "react";

/**
 * Two-ring donut: how much of what CDE's sources offer actually reaches the app.
 *
 * Why two rings rather than one pie: a two-slice pie is a stat tile with extra
 * steps — the number IS the chart. The rings earn their place only because the
 * split is hierarchical: ring 1 is the headline fraction (integrated or not),
 * ring 2 breaks each half down by the source it came from, aligned radially so
 * the relationship is read off the geometry.
 *
 * Encoding:
 *   ring 1 — emphasis: the integrated arc in the accent hue, the gap in the
 *            de-emphasis neutral. Two classes, ΔE 31.7 normal / 29.0 protan.
 *   ring 2 — hue carries the SOURCE (blue ERDDAP / orange OBIS, ΔE 33.6 normal
 *            / 24.7 protan), and the lighter step of that same hue carries
 *            "not integrated". The light steps are sequential steps within one
 *            hue, not independent categorical classes, so identity never rests
 *            on them alone: every segment is in the legend, the arcs carry
 *            direct labels, and the same numbers are printed beneath.
 *
 * Colours live in styles.css as --harvest-viz-* so they sit with the rest of
 * the section's tokens rather than being hardcoded here.
 */

const SIZE = 260;
const CENTER = SIZE / 2;
// Ring 2 sits outside ring 1 with a gap between, so the two levels read as
// levels rather than as one thick band.
const RINGS = [
  { inner: 52, outer: 86 },
  { inner: 92, outer: 122 },
];
// A 2px surface gap between fills, expressed as the angle that subtends at the
// ring's own radius, so both rings get the same visual gap.
const GAP_PX = 2;

function polar(cx, cy, r, angle) {
  const a = (angle - 90) * (Math.PI / 180);
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function arcPath(startAngle, endAngle, innerR, outerR) {
  const sweep = endAngle - startAngle;
  if (sweep <= 0) return "";
  const large = sweep > 180 ? 1 : 0;
  const [ox1, oy1] = polar(CENTER, CENTER, outerR, startAngle);
  const [ox2, oy2] = polar(CENTER, CENTER, outerR, endAngle);
  const [ix2, iy2] = polar(CENTER, CENTER, innerR, endAngle);
  const [ix1, iy1] = polar(CENTER, CENTER, innerR, startAngle);
  return [
    `M ${ox1} ${oy1}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${ix1} ${iy1}`,
    "Z",
  ].join(" ");
}

/** Lay segments end to end around the circle, trimming each by the gap. */
function layout(segments, total, ring) {
  const gapDeg = total ? (GAP_PX / (Math.PI * 2 * ring.outer)) * 360 : 0;
  let cursor = 0;
  return segments.map((seg) => {
    const sweep = total ? (seg.value / total) * 360 : 0;
    const start = cursor;
    cursor += sweep;
    // Never let the gap eat a thin segment entirely — a 1-dataset slice must
    // still be visible and hoverable.
    const trim = Math.min(gapDeg, sweep / 3);
    return { ...seg, start: start + trim / 2, end: start + sweep - trim / 2, sweep };
  });
}

function pct(value, total) {
  if (!total) return "0%";
  const p = (value / total) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
}

export default function CoverageDonut({ rings, total, caption, hint, centerLabel }) {
  const [hovered, setHovered] = useState(null);

  const laid = rings.map((segments, i) => layout(segments, total, RINGS[i]));
  const integratedPct = pct(rings[0][0]?.value || 0, total);

  return (
    <figure className="harvest-viz">
      <div className="harvest-viz-figure">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={caption}
        >
          {laid.map((segments, ringIndex) =>
            segments.map((seg) => (
              <path
                key={`${ringIndex}-${seg.key}`}
                d={arcPath(seg.start, seg.end, RINGS[ringIndex].inner, RINGS[ringIndex].outer)}
                fill={`var(${seg.color})`}
                className={
                  "harvest-viz-arc" +
                  (hovered && hovered.key !== seg.key ? " is-dimmed" : "")
                }
                onMouseEnter={() => setHovered(seg)}
                onMouseLeave={() => setHovered(null)}
              />
            )),
          )}
          <text x={CENTER} y={CENTER - 4} className="harvest-viz-center-value">
            {integratedPct}
          </text>
          <text x={CENTER} y={CENTER + 16} className="harvest-viz-center-label">
            {centerLabel}
          </text>
        </svg>

        {/* Fixed height and a short resting hint: the caption used to live here
            and wrapped to three lines, so the whole block reflowed on hover. */}
        <div className="harvest-viz-readout" role="status">
          {hovered ? (
            <>
              <span
                className="harvest-viz-swatch"
                style={{ background: `var(${hovered.color})` }}
              />
              <strong>{hovered.label}</strong>&nbsp;
              {hovered.value.toLocaleString()} ({pct(hovered.value, total)})
            </>
          ) : (
            <span className="harvest-muted">{hint}</span>
          )}
        </div>
      </div>

      {/* Identity never rests on colour: every segment is named here, and the
          same numbers appear in the table below the chart. */}
      <ul className="harvest-viz-legend">
        {laid.flat().map((seg) => (
          <li key={seg.key} className="harvest-viz-legend-item">
            <span
              className="harvest-viz-swatch"
              style={{ background: `var(${seg.color})` }}
            />
            <span className="harvest-viz-legend-label">{seg.label}</span>
            <span className="harvest-viz-legend-value">
              {seg.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>

      <figcaption className="harvest-viz-caption harvest-muted harvest-text-sm">
        {caption}
      </figcaption>
    </figure>
  );
}
