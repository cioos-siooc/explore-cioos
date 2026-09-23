import * as React from "react";
import { Lightbulb } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CloseButton from "../../ui/CloseButton.jsx";
import TipPointer from "./TipPointer.jsx";
import TipText from "./TipText.jsx";
import { TIPS, useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// The tip the user just earned by doing what it is about (see TipsProvider).
// Where the screen is wide enough to fit it beside the centered brand card, it
// holds the top-right corner, which nothing else claims; narrower, it flows
// last in the top bar's column instead. A status rather than a dialog:
// announced, but it never takes focus from what the user is doing,
// and it stays until dismissed rather than timing out mid-read.
export default function TipCard({ corner = false }) {
  const { t } = useTranslation();
  const { activeTip, touring, stepTour, dismissTip, disableTips } = useTips();

  if (!activeTip) return null;

  return (
    <div
      className={classNames("tipCard", { tipCardCorner: corner })}
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
