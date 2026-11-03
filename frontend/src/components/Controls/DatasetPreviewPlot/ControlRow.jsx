import * as React from "react";

import Tooltip from "../../ui/Tooltip.jsx";

/**
 * One labelled control in the parameters pane: the caption above it, with an
 * optional `action` (a small button acting on that control's value) at the
 * caption's end. `startsGroup` rules it off from the rows above.
 */
export default function ControlRow({
  caption,
  tooltip,
  action,
  startsGroup = false,
  children,
}) {
  // .dropdown .btn is inline-flex, so a bare string becomes an anonymous flex
  // item that text-overflow cannot reach and min-width: auto will not shrink.
  const control = <span className="controlButtonWrap">{children}</span>;

  return (
    <div className={startsGroup ? "controlRow startsGroup" : "controlRow"}>
      <div className="controlHeader">
        <span className="controlCaption">{caption}</span>
        {action}
      </div>
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
