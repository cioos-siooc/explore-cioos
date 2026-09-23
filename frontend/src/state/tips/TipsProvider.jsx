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
import useTourStages from "./useTourStages.js";

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
  "realtime",
  "trackDate",
  "griddapWms",
  "griddedCoverage",
  "nonna",
  "globe",
  "sizeLimit",
];

// Outside the provider (leaf-component tests render without it) offering a
// tip is a no-op rather than a crash.
const TipsContext = createContext({
  offerTip: () => {},
  tipHighlight: () => undefined,
});

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
  // Paging through every tip on request (from the About dialog) rather than
  // being offered one: none of the rules below apply while it runs.
  const [touring, setTouring] = useState(false);

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
  const gate = useRef({ tipsEnabled, seenTips, modalOpen, touring });
  useEffect(() => {
    gate.current = { tipsEnabled, seenTips, modalOpen, touring };
  }, [tipsEnabled, seenTips, modalOpen, touring]);

  // Takes one key or several in priority order, and offers the first not yet
  // seen — so a page with a specific tip of its own falls back to the general
  // one once that has been read.
  //
  // One tip per visit at most, each tip once ever, and never behind a modal:
  // an offer made while one is up (a filter set from the Filters dialog, say)
  // waits for it to close. The latest such offer wins.
  const pendingTip = useRef();
  const offerTip = useCallback(
    (keys) => {
      const { tipsEnabled, seenTips, modalOpen, touring } = gate.current;
      if (firstVisit || shownThisLoad.current || !tipsEnabled || touring) {
        return;
      }
      const key = [keys].flat().find((k) => !seenTips.includes(k));
      if (!key) return;
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

  // For the `data-tip-highlight` attribute of the control a tip talks about,
  // so the tip card's text has something on screen to point at. Undefined,
  // not false, so React drops the attribute rather than writing "false".
  const tipHighlight = useCallback(
    (key) => (key && key === activeTip) || undefined,
    [activeTip],
  );

  // Read at call time: the stages close over the selection and the catalogue,
  // which change far more often than a step is taken.
  const stages = useTourStages();
  const stagesRef = useRef(stages);
  useEffect(() => {
    stagesRef.current = stages;
  });

  const showTourStep = useCallback((key) => {
    setActiveTip(key);
    stagesRef.current[key]?.();
  }, []);
  const startTour = useCallback(
    (key) => {
      // The tour is this visit's tip; nothing is offered on top of it after.
      shownThisLoad.current = true;
      setTouring(true);
      showTourStep(key);
    },
    [showTourStep],
  );
  const stepTour = useCallback(
    (step) =>
      showTourStep(
        TIPS[(TIPS.indexOf(activeTip) + step + TIPS.length) % TIPS.length],
      ),
    [activeTip, showTourStep],
  );

  const dismissTip = useCallback(() => {
    setActiveTip();
    setTouring(false);
  }, []);
  const disableTips = useCallback(() => {
    setTipsEnabled(false);
    setActiveTip();
  }, [setTipsEnabled]);

  const value = {
    activeTip,
    offerTip,
    tipHighlight,
    touring,
    startTour,
    stepTour,
    dismissTip,
    disableTips,
    tipsEnabled,
    setTipsEnabled,
  };

  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
}
