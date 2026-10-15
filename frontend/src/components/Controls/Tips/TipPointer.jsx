import * as React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HandIndexThumbFill } from "react-bootstrap-icons";
import classNames from "classnames";

// The hand's size and its gap from the control (.tipPointer, .tipPointerBadge),
// so the card can be hung just past the hand.
const POINTER_GAP = 12;
const POINTER_SIZE = 42;
const CARD_MARGIN = 12;
const CARD_MAX_WIDTH = 360;

const sameRects = (a, b) =>
  a.length === b.length &&
  a.every(
    (rect, i) =>
      Math.round(rect.left) === Math.round(b[i].left) &&
      Math.round(rect.top) === Math.round(b[i].top) &&
      Math.round(rect.width) === Math.round(b[i].width) &&
      Math.round(rect.height) === Math.round(b[i].height),
  );

// From below for a control in the top half of the screen, from above
// otherwise, so the hand (and the card past it) lands on the side with room.
export const pointsFromBelow = (rect, viewportHeight = window.innerHeight) =>
  rect.top + rect.height / 2 < viewportHeight / 2;

// Where the tip card goes to sit just past the hand pointing at `rect`:
// centered on the control and kept on screen. Hung from its far edge (`bottom`
// when above) so its own height never needs measuring.
export function anchorCardStyle(
  rect,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
) {
  const width = Math.min(CARD_MAX_WIDTH, viewportWidth - 2 * CARD_MARGIN);
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, CARD_MARGIN),
    viewportWidth - width - CARD_MARGIN,
  );
  const offset = POINTER_GAP + POINTER_SIZE + 4;
  return pointsFromBelow(rect, viewportHeight)
    ? { left, width, top: rect.bottom + offset }
    : { left, width, bottom: viewportHeight - rect.top + offset };
}

// The on-screen rects of the controls the active tip talks about (the
// elements carrying `data-tip-highlight`), followed every frame while
// `enabled`, since the controls slide in with the panels that hold them.
export function useTipTargets(enabled, inModal) {
  const [targets, setTargets] = useState([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let frame;
    // Each control is brought into view once, as it first turns up: a hand
    // pointing at the foot of a scrolled-away list points at nothing.
    const revealed = new WeakSet();
    const follow = () => {
      // From inside a dialog, only what the dialog holds: the rest of the page
      // is behind it.
      const shown = [
        ...document.querySelectorAll(
          inModal ? ".modal [data-tip-highlight]" : "[data-tip-highlight]",
        ),
      ]
        .map((element) => [element, element.getBoundingClientRect()])
        // Sized and on screen: the cards that slide away (the sidebar, the
        // what's here card) are parked past the edge rather than unmounted.
        .filter(
          ([, rect]) =>
            rect.width &&
            rect.height &&
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight,
        );
      shown.forEach(([element]) => {
        if (revealed.has(element)) return;
        revealed.add(element);
        element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      });
      const next = shown.map(([, rect]) => rect);
      setTargets((previous) => (sameRects(previous, next) ? previous : next));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => cancelAnimationFrame(frame);
  }, [enabled, inModal]);

  return enabled ? targets : [];
}

// A hand pointing at each of `targets` (see useTipTargets). Drawn over the
// page rather than on the control itself: the top bar's strip clips anything
// drawn past its edges, and several of the controls are fixed surfaces a
// positioned child would upset.
export default function TipPointer({ targets, inModal = false }) {
  return createPortal(
    targets.map((rect, i) => {
      const fromBelow = pointsFromBelow(rect);
      return (
        <span
          key={i}
          className={classNames("tipPointer", {
            tipPointerAbove: !fromBelow,
            tipPointerOverModal: inModal,
          })}
          style={{
            left: rect.left + rect.width / 2,
            top: fromBelow ? rect.bottom : rect.top,
          }}
          data-testid="tip-pointer"
          aria-hidden="true"
        >
          <span className="tipPointerBadge">
            <HandIndexThumbFill size={22} />
          </span>
        </span>
      );
    }),
    document.body,
  );
}
