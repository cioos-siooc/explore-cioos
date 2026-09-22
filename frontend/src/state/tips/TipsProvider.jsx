import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { usePersistentState } from "../usePersistentState.js";
import { useUI } from "../ui/UIProvider.jsx";

// Every tip, in the order the About dialog pages through them. The copy is
// `tip_<key>` in the locale files. Most are also offered on the map the first
// time the user does the thing they are about (see offerTip's callers); the
// rest are only reachable from the dialog.
export const TIPS = [
  "shareLink",
  "whatsHere",
  "reshapeArea",
  "inView",
  "sliderKeys",
  "timeCoverage",
  "datasetNav",
  "filterMap",
  "realtime",
  "griddapWms",
  "nonna",
  "globe",
  "sizeLimit",
];

// Outside the provider (leaf-component tests render without it) offering a
// tip is a no-op rather than a crash.
const TipsContext = createContext({ offerTip: () => {} });

export function useTips() {
  return useContext(TipsContext);
}

export default function TipsProvider({ children }) {
  const {
    showIntroModal,
    showFiltersModal,
    showDownloadModal,
    showCoverageModal,
    showSelectionHelpModal,
  } = useUI();
  const [tipsEnabled, setTipsEnabled] = usePersistentState("tipsEnabled", true);
  const [seenTips, setSeenTips] = usePersistentState("seenTips", []);
  const [activeTip, setActiveTip] = useState();

  // The intro opens by itself only on a first visit, and already covers the
  // basics — a tip on top of that would be one thing too many on day one.
  const [firstVisit] = useState(showIntroModal);
  const shownThisLoad = useRef(false);

  const modalOpen =
    showIntroModal ||
    showFiltersModal ||
    showDownloadModal ||
    showCoverageModal ||
    showSelectionHelpModal;
  // offerTip is called from map event handlers registered once, so it has to
  // be stable and read the latest state through a ref. Seeded, not left empty:
  // children's mount effects run before this component's own.
  const gate = useRef({ tipsEnabled, seenTips, modalOpen });
  useEffect(() => {
    gate.current = { tipsEnabled, seenTips, modalOpen };
  }, [tipsEnabled, seenTips, modalOpen]);

  // One tip per visit at most, each tip once ever, and never behind a modal:
  // an offer made while one is up (a filter set from the Filters dialog, say)
  // waits for it to close. The latest such offer wins.
  const pendingTip = useRef();
  const offerTip = useCallback(
    (key) => {
      const { tipsEnabled, seenTips, modalOpen } = gate.current;
      if (firstVisit || shownThisLoad.current || !tipsEnabled) return;
      if (seenTips.includes(key)) return;
      if (modalOpen) {
        pendingTip.current = key;
        return;
      }
      shownThisLoad.current = true;
      setSeenTips([...seenTips, key]);
      setActiveTip(key);
    },
    [firstVisit, setSeenTips],
  );

  useEffect(() => {
    if (modalOpen || !pendingTip.current) return;
    const key = pendingTip.current;
    pendingTip.current = undefined;
    offerTip(key);
  }, [modalOpen, offerTip]);

  const dismissTip = useCallback(() => setActiveTip(), []);
  const disableTips = useCallback(() => {
    setTipsEnabled(false);
    setActiveTip();
  }, [setTipsEnabled]);

  const value = {
    activeTip,
    offerTip,
    dismissTip,
    disableTips,
    tipsEnabled,
    setTipsEnabled,
  };

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
}
