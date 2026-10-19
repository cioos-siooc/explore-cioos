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

// Order the About dialog pages through them; copy is `tip_<key>` in the locale
// files. Limited to what changes what the user finds or gets: how a control
// works belongs on the control.
export const TIPS = [
  "whatsHere",
  "inView",
  "timeCoverage",
  "speciesName",
  "exclude",
  "matchAll",
  "realtime",
  "showData",
  "trajectory",
  "griddapWms",
  "filtersCutDownload",
  "directLinks",
  "shareLink",
];

// While that dialog is open the tip is shown inside it, and the tour opens it.
export const TIP_MODALS = {
  speciesName: "filters",
  exclude: "filters",
  matchAll: "filters",
  filtersCutDownload: "download",
  directLinks: "download",
};

// Leaf-component tests render without the provider, so the default no-ops.
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
    setShowFiltersModal,
    setShowDownloadModal,
  } = useUI();
  const [tipsEnabled, setTipsEnabled] = usePersistentState("tipsEnabled", true);
  const [seenTips, setSeenTips] = usePersistentState("seenTips", []);
  const [activeTip, setActiveTip] = useState();
  // None of the offer rules below apply while touring.
  const [touring, setTouring] = useState(false);

  // The intro already covers the basics on a first visit.
  const [firstVisit] = useState(showIntroModal);
  const shownThisLoad = useRef(false);

  const modalOpen =
    showIntroModal ||
    showFiltersModal ||
    showDownloadModal ||
    showCoverageModal ||
    showSelectionHelpModal;
  // offerTip is called from map handlers registered once, so it reads state
  // through a ref. Seeded because children's mount effects run first.
  const gate = useRef({ tipsEnabled, seenTips, modalOpen, touring });
  useEffect(() => {
    gate.current = { tipsEnabled, seenTips, modalOpen, touring };
  }, [tipsEnabled, seenTips, modalOpen, touring]);

  // Offers the first unseen of the given keys. One tip per visit, each once
  // ever, never behind a modal: an offer made while one is up waits for it to
  // close, and the latest wins.
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

  // Undefined, not false, so React drops the attribute.
  const tipHighlight = useCallback(
    (key) => (key && key === activeTip) || undefined,
    [activeTip],
  );

  // The stages close over the selection and catalogue, which change far more
  // often than a step is taken.
  const { stages, skipped } = useTourStages();
  const stagesRef = useRef(stages);
  useEffect(() => {
    stagesRef.current = stages;
  });

  // So the next step's control isn't left behind it; one the user opened stays.
  const tourModal = useRef();
  const closeTourModal = useCallback(() => {
    if (tourModal.current === "filters") setShowFiltersModal(false);
    if (tourModal.current === "download") setShowDownloadModal(false);
    tourModal.current = undefined;
  }, [setShowFiltersModal, setShowDownloadModal]);

  const showTourStep = useCallback(
    (key) => {
      if (tourModal.current && tourModal.current !== TIP_MODALS[key]) {
        closeTourModal();
      }
      setActiveTip(key);
      const opened = stagesRef.current[key]?.();
      if (opened) tourModal.current = opened;
    },
    [closeTourModal],
  );
  const startTour = useCallback(
    (key) => {
      // The tour is this visit's tip; nothing is offered on top of it after.
      shownThisLoad.current = true;
      setTouring(true);
      showTourStep(key);
    },
    [showTourStep],
  );
  // The one up stays in the count even if its control has gone, so stepping
  // on still works.
  const tourTips = TIPS.filter((key) => key === activeTip || !skipped.has(key));

  // Stepping on from an offered tip turns it into a tour.
  const stepTour = (step) => {
    setTouring(true);
    showTourStep(
      tourTips[
        (tourTips.indexOf(activeTip) + step + tourTips.length) % tourTips.length
      ],
    );
  };

  const dismissTip = useCallback(() => {
    closeTourModal();
    setActiveTip();
    setTouring(false);
  }, [closeTourModal]);

  const disableTips = useCallback(() => {
    setTipsEnabled(false);
    setActiveTip();
  }, [setTipsEnabled]);

  const value = {
    activeTip,
    tourTips,
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
