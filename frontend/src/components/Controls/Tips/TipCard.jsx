import * as React from "react";
import { Lightbulb } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CloseButton from "../../ui/CloseButton.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// The tip the user just earned by doing what it is about (see TipsProvider).
// Last in the top bar's column, so it flows under the chips without a position
// of its own to keep clear of the other floating surfaces. A status rather than
// a dialog: announced, but it never takes focus from what the user is doing,
// and it stays until dismissed rather than timing out mid-read.
export default function TipCard() {
  const { t } = useTranslation();
  const { activeTip, dismissTip, disableTips } = useTips();

  if (!activeTip) return null;

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
        <p>{t(`tip_${activeTip}`)}</p>
        <button type="button" className="tipCardDisable" onClick={disableTips}>
          {t("tipsDisable")}
        </button>
      </div>
      <CloseButton label={t("tipCardClose")} onClick={dismissTip} />
    </div>
  );
}
