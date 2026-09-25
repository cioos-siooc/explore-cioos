import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";

// A slot under the brand card whose content slides out from under the card as
// it appears and back under it as it goes, the slot's height opening and
// closing with it so the rows below follow rather than jump. `contentKey` names
// what the slot holds (null for nothing): a change of key is a swap, run one
// after the other — the old content goes up under the card, then the new one
// comes down from it. Content already up on first render is simply there.
export default function TopBarRow({ contentKey, children }) {
  const [shown, setShown] = useState(
    contentKey == null ? null : { key: contentKey, children },
  );
  const [phase, setPhase] = useState(null);
  const rowRef = useRef(null);

  if (!shown && contentKey != null) {
    setShown({ key: contentKey, children });
    setPhase("entering");
  } else if (shown && shown.key === contentKey) {
    if (shown.children !== children) setShown({ key: contentKey, children });
    if (phase === "leaving") setPhase("entering");
  } else if (shown && phase !== "leaving") {
    setPhase("leaving");
  }

  function settle() {
    if (phase !== "leaving") setPhase(null);
    else if (contentKey == null) {
      setShown(null);
      setPhase(null);
    } else {
      setShown({ key: contentKey, children });
      setPhase("entering");
    }
  }

  // Nothing to wait for where the slide doesn't run (no stylesheet, as under
  // jsdom): a phase that won't fire animationend ends at once.
  useLayoutEffect(() => {
    if (!phase || !rowRef.current) return;
    if (!getComputedStyle(rowRef.current).animationName.startsWith("topBar"))
      settle();
  });

  if (!shown) return null;

  return (
    <div
      ref={rowRef}
      className={classNames("topBarRow", phase)}
      inert={phase === "leaving" ? "" : undefined}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) settle();
      }}
    >
      <div className="topBarRowInner">{shown.children}</div>
    </div>
  );
}
