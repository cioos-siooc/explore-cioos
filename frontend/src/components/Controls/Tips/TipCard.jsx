import * as React from "react";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CloseButton from "../../ui/CloseButton.jsx";
import TipPointer from "./TipPointer.jsx";
import TipText from "./TipText.jsx";
import { TIPS, useTips } from "../../../state/tips/TipsProvider.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// The tip the user just earned by doing what it is about (see TipsProvider).
// It holds a corner of the map (see .tipCard); on phones, where the card would
// cover too much of it, it waits as a lightbulb button until tapped. A status
// rather than a dialog: announced, but it never takes focus from what the user
// is doing, and — bar the few fleeting ones — it stays until dismissed rather
// than timing out mid-read.
export default function TipCard() {
  const { t } = useTranslation();
  const { activeTip, touring, stepTour, dismissTip, disableTips } = useTips();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [openedTip, setOpenedTip] = useState(null);

  if (!activeTip) return null;

  // A tour was asked for, so it opens straight away.
  if (isMobile && !touring && openedTip !== activeTip) {
    return (
      <div className="tipBadge" role="status">
        <button
          type="button"
          className="tipBadgeButton"
          aria-label={t("tipCardOpen")}
          aria-expanded="false"
          onClick={() => setOpenedTip(activeTip)}
        >
          <Lightbulb size={22} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="tipCard"
      role="status"
      data-testid="tip-card"
      onKeyDown={(e) => {
        if (e.key === "Escape") dismissTip();
      }}
    >
      {/* The header row holds the counter, the steps and the close, so they
          stay put whatever the length of the text beneath them. */}
      <div className="tipCardHeader">
        <Lightbulb className="tipCardIcon" size={16} aria-hidden="true" />
        <span className="tipCardHeading">
          {t("tipCounter", {
            n: TIPS.indexOf(activeTip) + 1,
            total: TIPS.length,
          })}
        </span>
        <button
          type="button"
          className="tipCardStep"
          title={t("tipPrevious")}
          aria-label={t("tipPrevious")}
          onClick={() => stepTour(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tipCardStep"
          title={t("tipNext")}
          aria-label={t("tipNext")}
          onClick={() => stepTour(1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <CloseButton label={t("tipCardClose")} onClick={dismissTip} />
      </div>
      <p className="tipCardText">
        <TipText tip={activeTip} />
      </p>
      {!touring && (
        <button type="button" className="tipCardLink" onClick={disableTips}>
          {t("tipsDisable")}
        </button>
      )}
      <TipPointer />
    </div>
  );
}
