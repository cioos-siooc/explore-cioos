import * as React from "react";
import { useState } from "react";
import classNames from "classnames";
import { ChevronLeft, ChevronRight, Lightbulb } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CloseButton from "../../ui/CloseButton.jsx";
import TipPointer, {
  anchorCardStyle,
  pointsFromBelow,
  useTipTargets,
} from "./TipPointer.jsx";
import TipText from "./TipText.jsx";
import {
  TIP_MODALS,
  TIPS,
  useTips,
} from "../../../state/tips/TipsProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

// The tip the user just earned by doing what it is about (see TipsProvider).
// It sits just past the hand pointing at the control it talks about, or holds
// a corner of the map (see .tipCard) while that control is off screen; on
// phones, where the card would cover too much of it, it waits as a lightbulb
// button until tapped. A status
// rather than a dialog: announced, but it never takes focus from what the user
// is doing, and it stays until dismissed rather than timing out mid-read.
//
// A tip about a control inside a dialog (TIP_MODALS) moves into that dialog
// while it is open — rendered there with `inModal` naming it — since the
// dialog covers the map corner the card otherwise holds. It stays in the
// dialog's DOM even when hung by its control, so the dialog's focus trap and
// Escape still cover it.
export default function TipCard({ inModal }) {
  const { t } = useTranslation();
  const { activeTip, touring, stepTour, dismissTip, disableTips } = useTips();
  const { showFiltersModal, showDownloadModal } = useUI();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [openedTip, setOpenedTip] = useState(null);

  const tipModal = TIP_MODALS[activeTip];
  const shown =
    Boolean(activeTip) &&
    (inModal
      ? tipModal === inModal
      : !{ filters: showFiltersModal, download: showDownloadModal }[tipModal]);
  // A tour was asked for, so it opens straight away. Inside a dialog the card
  // takes no map space, so it never waits as a badge there.
  const waiting = isMobile && !touring && !inModal && openedTip !== activeTip;
  const targets = useTipTargets(shown && !waiting, Boolean(inModal));

  if (!shown) return null;

  if (waiting) {
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

  const anchor = targets[0];
  return (
    <div
      className={classNames("tipCard", {
        tipCardInModal: inModal,
        tipCardAnchored: anchor,
        tipCardAbove: anchor && !pointsFromBelow(anchor),
      })}
      style={anchor ? anchorCardStyle(anchor) : undefined}
      role="status"
      data-testid="tip-card"
      onKeyDown={(e) => {
        if (e.key === "Escape") dismissTip();
      }}
      // An open filter folds on any click outside it (see useOutsideAlerter);
      // stepping through the tour from in here shouldn't count as one.
      onMouseDown={inModal ? (e) => e.stopPropagation() : undefined}
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
      <TipPointer targets={targets} inModal={Boolean(inModal)} />
    </div>
  );
}
