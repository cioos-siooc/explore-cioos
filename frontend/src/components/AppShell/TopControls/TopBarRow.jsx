import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import classNames from "classnames";

// `contentKey` names what the slot holds (null for nothing); a key change runs
// old-out then new-in. Content present on first render is simply there.
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

  // Where the slide doesn't run (jsdom) animationend never fires, so end now.
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
