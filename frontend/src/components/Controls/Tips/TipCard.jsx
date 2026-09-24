import * as React from "react";
import { useState } from "react";
import { Lightbulb } from "react-bootstrap-icons";
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
      <Lightbulb className="tipCardIcon" size={18} aria-hidden="true" />
      <div className="tipCardBody">
        <span className="tipCardHeading">{t("tipCardHeading")}</span>
        <p>
          <TipText tip={activeTip} />
        </p>
        {touring ? (
          <div className="tipCardTour">
            <span className="tipCardCount">
              {t("tipCounter", {
                n: TIPS.indexOf(activeTip) + 1,
                total: TIPS.length,
              })}
            </span>
            <button
              type="button"
              className="tipCardLink"
              onClick={() => stepTour(-1)}
            >
              {t("tipPrevious")}
            </button>
            <button
              type="button"
              className="tipCardLink"
              onClick={() => stepTour(1)}
            >
              {t("tipNext")}
            </button>
          </div>
        ) : (
          <button type="button" className="tipCardLink" onClick={disableTips}>
            {t("tipsDisable")}
          </button>
        )}
      </div>
      <CloseButton label={t("tipCardClose")} onClick={dismissTip} />
      <TipPointer />
    </div>
  );
}
