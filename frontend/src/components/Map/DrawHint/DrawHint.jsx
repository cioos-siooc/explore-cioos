import * as React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import useMediaQuery, { TOUCH_QUERY } from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// What to do next while a box or polygon is being drawn (see
// drawHintModes.js), beside the pointer. Not one of the tips: it is how the
// tool works rather than something to discover, so it shows every time and
// stays out of the tour. A finished shape gets a few seconds of how to
// reshape it. Until a mouse has been over the map — never, on a
// touch screen — it sits at the foot of the map, clear of where the taps go.
const RESHAPE_HINT_MS = 5000;

export default function DrawHint({ map }) {
  const { t } = useTranslation();
  const [hint, setHint] = useState(null);
  const [at, setAt] = useState(null);
  const touch = useMediaQuery(TOUCH_QUERY);

  useEffect(() => {
    if (!map) return;
    const onHint = (e) => {
      setHint(e.hint);
      // Where the last drawing ended says nothing about where this one starts.
      if (!e.hint) setAt(null);
    };
    const onPointer = (e) =>
      setAt({ x: e.originalEvent.clientX, y: e.originalEvent.clientY });
    const onCreate = () => setHint("reshape");
    map.on("draw.hint", onHint);
    map.on("draw.create", onCreate);
    map.on("mousemove", onPointer);
    return () => {
      map.off("draw.hint", onHint);
      map.off("draw.create", onCreate);
      map.off("mousemove", onPointer);
    };
  }, [map]);

  useEffect(() => {
    if (hint !== "reshape") return;
    const timer = setTimeout(() => setHint(null), RESHAPE_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  if (!hint) return null;
  // Phones send an emulated mousemove with a tap, which would put the hint
  // under the finger.
  const follow = !touch && at;

  return (
    <div
      className={classNames("drawHint", { drawHintDocked: !follow })}
      role="status"
      data-testid="draw-hint"
      style={follow ? { left: at.x, top: at.y } : undefined}
    >
      {t(`drawHint_${hint}`, { context: touch ? "touch" : undefined })}
    </div>
  );
}
