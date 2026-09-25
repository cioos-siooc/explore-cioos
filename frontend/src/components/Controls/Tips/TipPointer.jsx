import * as React from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { HandIndexThumbFill } from "react-bootstrap-icons";
import classNames from "classnames";

const sameRects = (a, b) =>
  a.length === b.length &&
  a.every(
    (rect, i) =>
      Math.round(rect.left) === Math.round(b[i].left) &&
      Math.round(rect.top) === Math.round(b[i].top) &&
      Math.round(rect.width) === Math.round(b[i].width) &&
      Math.round(rect.height) === Math.round(b[i].height),
  );

// A hand pointing at each control the active tip talks about (the elements
// carrying `data-tip-highlight`). Drawn over the page rather than on the
// control itself: the top bar's strip clips anything drawn past its edges, and
// several of the controls are fixed surfaces a positioned child would upset.
// Followed every frame while it is up, since the controls it points at slide
// in with the panels that hold them.
export default function TipPointer() {
  const [targets, setTargets] = useState([]);

  useEffect(() => {
    let frame;
    // Each control is brought into view once, as it first turns up: a hand
    // pointing at the foot of a scrolled-away list points at nothing.
    const revealed = new WeakSet();
    const follow = () => {
      const shown = [...document.querySelectorAll("[data-tip-highlight]")]
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
  }, []);

  return createPortal(
    targets.map((rect, i) => {
      // From below for a control in the top half of the screen, from above
      // otherwise, so the hand lands on the side with room for it.
      const fromBelow = rect.top + rect.height / 2 < window.innerHeight / 2;
      return (
        <span
          key={i}
          className={classNames("tipPointer", { tipPointerAbove: !fromBelow })}
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
