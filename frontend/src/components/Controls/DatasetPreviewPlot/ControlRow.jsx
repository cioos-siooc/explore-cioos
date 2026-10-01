import * as React from "react";

import Tooltip from "../../ui/Tooltip.jsx";

/**
 * One labelled control in the parameters pane.
 */
export default function ControlRow({ caption, hint, tooltip, children }) {
  // .dropdown .btn is inline-flex, so a bare string becomes an anonymous flex
  // item that text-overflow cannot reach and min-width: auto will not shrink.
  const control = <span className="controlButtonWrap">{children}</span>;

  return (
    <div className="controlRow">
      <span className="controlCaption">
        {caption}
        {hint && <span className="controlCaptionHint"> {hint}</span>}
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
