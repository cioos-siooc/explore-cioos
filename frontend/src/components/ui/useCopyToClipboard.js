import { useCallback, useEffect, useRef, useState } from "react";

import reportError from "../../state/reportError.js";

/*
 * Copy text, and remember which button did it for long enough for that button
 * to say so in place of its own label.
 *
 * One key at a time: the confirmation is about the click that just happened,
 * so a second copy moves the tick rather than lighting up two.
 */
export default function useCopyToClipboard({ resetAfter = 1500 } = {}) {
  const [copiedKey, setCopiedKey] = useState(null);
  const timer = useRef(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback(
    async (key, text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        // Restarting the timer rather than adding one keeps the tick's life
        // measured from the last click, not the first.
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopiedKey(null), resetAfter);
      } catch (error) {
        // A denied clipboard permission is not an app failure, but a button
        // that silently does nothing looks like a dead one.
        reportError("copying to the clipboard failed", error);
      }
    },
    [resetAfter],
  );

  return { copy, copiedKey };
}
