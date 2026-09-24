import * as React from "react";
import { useTranslation } from "react-i18next";

import Tooltip from "../../ui/Tooltip.jsx";

// Which key names each axis's direction, so the caption can say which way round
// this plot is drawn. See axisDirectionsFor.
const DIRECTION_LABELS = {
  vertical: "datasetPreviewPlotAxisVertical",
  horizontal: "datasetPreviewPlotAxisHorizontal",
};
const DIRECTION_GLYPHS = { vertical: "↕", horizontal: "↔" };

/**
 * One labelled control in the parameters pane.
 *
 * `direction` adds the glyph that says which way this plot draws that axis —
 * labelled rather than aria-hidden, because ui/Tooltip portals its bubble with
 * no aria-describedby, so a tooltip here would never be announced.
 */
export default function ControlRow({ caption, direction, tooltip, children }) {
  const { t } = useTranslation();
  // .dropdown .btn is inline-flex, so a bare string becomes an anonymous flex
  // item that text-overflow cannot reach and min-width: auto will not shrink.
  const control = <span className="controlButtonWrap">{children}</span>;

  return (
    <div className="controlRow">
      <span className="controlCaption">
        {caption}
        {direction && (
          <>
            {" "}
            <span
              className="controlCaptionDirection"
              role="img"
              aria-label={t(DIRECTION_LABELS[direction])}
            >
              {DIRECTION_GLYPHS[direction]}
            </span>
          </>
        )}
      </span>
      {tooltip ? (
        <Tooltip placement="right" content={tooltip}>
          {control}
        </Tooltip>
      ) : (
        control
      )}
    </div>
  );
}
