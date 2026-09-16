import { useCallback, useEffect, useRef, useState } from "react";

import reportError from "./reportError.js";

// How long "Copied" stays up. Long enough to be read after the eye moves back
// to the button, short enough that it is gone before the next copy.
const FLASH_MS = 2000;

/*
 * Copy text, and say for a moment whether it worked.
 *
 * The clipboard gives no sign of its own that a click did anything, so every
 * copy button has to flash its own result — and the three things that makes
 * fiddly are the same wherever it appears: navigator.clipboard is
 * secure-context only and simply absent over plain http (so a button that
 * assumes it silently does nothing), the flash needs a timer, and that timer
 * has to be cleared when the button unmounts or React warns about a state
 * update on a gone component. A card in a list of forty mounts and unmounts
 * far more often than the strip below it, so this is the half worth sharing;
 * what the button looks like is not.
 *
 * Returns the current state — null, "copied" or "failed" — and the copy.
 */
export default function useCopyToClipboard(what) {
  const [copyState, setCopyState] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    (text) => {
      const flash = (state) => {
        setCopyState(state);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopyState(null), FLASH_MS);
      };

      if (!navigator.clipboard) {
        flash("failed");
        return;
      }
      navigator.clipboard
        .writeText(text)
        .then(() => flash("copied"))
        .catch((error) => {
          reportError(`copying ${what} failed`, error);
          flash("failed");
        });
    },
    [what],
  );

  return [copyState, copy];
}
