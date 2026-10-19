import { useCallback, useEffect, useRef } from "react";

// A press on one of these is a tap on the control, never the start of a drag.
const INTERACTIVE = "button, a, input, select, textarea, label";
// How far the finger travels before a press becomes a drag, so a tap on the
// header that wobbles a pixel is still just a tap.
const DRAG_THRESHOLD = 6;
// Released past this share of its height, the sheet goes; short of it, it
// settles back — unless it was flicked.
const DISMISS_SHARE = 0.25;
const FLICK_VELOCITY = 0.5; // px/ms

// Drag-to-dismiss for a bottom sheet: the returned handler goes on the
// sheet's grab area (its handle and header). While dragged down the sheet
// follows the finger; released, it either slides the rest of the way out and
// calls onDismiss, or settles back. The motion is the sheet's own CSS
// transition — this only drives its transform between the two rests.
export default function useSheetDrag(sheetRef, onDismiss) {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  return useCallback(
    (event) => {
      const sheet = sheetRef.current;
      if (
        !sheet ||
        !event.isPrimary ||
        event.button !== 0 ||
        event.target.closest(INTERACTIVE)
      )
        return;
      const startY = event.clientY;
      let lastY = startY;
      let lastTime = event.timeStamp;
      let velocity = 0;
      let dragging = false;

      function onMove(moveEvent) {
        const offset = moveEvent.clientY - startY;
        if (!dragging) {
          if (offset < DRAG_THRESHOLD) return;
          dragging = true;
          sheet.style.transition = "none";
        }
        velocity =
          (moveEvent.clientY - lastY) /
          Math.max(1, moveEvent.timeStamp - lastTime);
        lastY = moveEvent.clientY;
        lastTime = moveEvent.timeStamp;
        sheet.style.transform = `translateY(${Math.max(0, offset)}px)`;
      }

      function onEnd(endEvent) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        if (!dragging) return;
        sheet.style.transition = "";
        const offset = endEvent.clientY - startY;
        const dismissed =
          endEvent.type === "pointerup" &&
          (offset > sheet.offsetHeight * DISMISS_SHARE ||
            velocity > FLICK_VELOCITY);
        if (!dismissed) {
          sheet.style.transform = "";
          return;
        }
        // Out from where the finger left it rather than from the rest it had
        // before the drag. The inline transform is dropped once the closed
        // state's own stylesheet transform has taken over at the same place.
        sheet.style.transform = "translateY(100%)";
        const clear = () => {
          sheet.style.transform = "";
        };
        if (getComputedStyle(sheet).transitionDuration === "0s") clear();
        else sheet.addEventListener("transitionend", clear, { once: true });
        onDismissRef.current();
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [sheetRef],
  );
}
