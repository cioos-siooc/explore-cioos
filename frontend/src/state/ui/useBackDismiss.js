import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

// Gives an open surface a history entry of its own, so the browser's Back —
// Android's back button and gesture — closes it instead of leaving the app.
// Closing it any other way takes that entry back off, so Back afterwards does
// not land on a no-op step.
//
// The entry is tracked by its location key: UrlSync replaces the address on
// every filter or camera change, and the key moves with those replaces. Back
// from the entry closes the surface; Back from an entry pushed on top of it (a
// dataset page opened from the list) only pops that one.
export default function useBackDismiss(open, onClose) {
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const entryKey = useRef(null);
  const lastKey = useRef(location.key);
  const pushing = useRef(false);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const previous = lastKey.current;
    lastKey.current = location.key;
    if (pushing.current) {
      if (navigationType === "PUSH") {
        pushing.current = false;
        entryKey.current = location.key;
      }
      return;
    }
    if (entryKey.current !== previous) return;
    if (navigationType === "REPLACE") entryKey.current = location.key;
    else if (navigationType === "POP") {
      entryKey.current = null;
      onCloseRef.current();
    }
  }, [location.key, navigationType]);

  // On the open/close transition rather than in a cleanup, so unmounting with
  // the page (a link to /harvest) never pops the navigation that unmounted it.
  useEffect(() => {
    if (open && !wasOpen.current) {
      pushing.current = true;
      // The same address without the entry's state: its fromList flag belongs
      // to the dataset page below, and "Back to datasets" from in here must
      // replace this entry rather than pop it and close the surface.
      navigate({
        pathname: location.pathname,
        search: location.search,
        hash: location.hash,
      });
    } else if (!open && wasOpen.current) {
      if (entryKey.current === lastKey.current) navigate(-1);
      entryKey.current = null;
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
