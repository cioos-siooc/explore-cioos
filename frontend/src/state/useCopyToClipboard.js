import { useCallback, useEffect, useRef, useState } from "react";

import reportError from "./reportError.js";

const FLASH_MS = 2000;

/*
 * navigator.clipboard is absent over plain http, and the flash timer must be
 * cleared on unmount. Returns null, "copied" or "failed", and the copy.
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
