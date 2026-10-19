import * as React from "react";
import { useEffect, useState } from "react";
import classNames from "classnames";
import { ChevronLeft, ChevronRight, Lightbulb } from "react-bootstrap-icons";
import { Trans, useTranslation } from "react-i18next";

import CloseButton from "../../ui/CloseButton.jsx";
import TipPointer, {
  anchorCardStyle,
  pointsFromBelow,
  useTipTargets,
} from "./TipPointer.jsx";
import TipText from "./TipText.jsx";
import { TIP_MODALS, useTips } from "../../../state/tips/TipsProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import "./styles.css";

const OWNS_ARROWS =
  'input, textarea, select, [contenteditable="true"], [role="slider"], .maplibregl-canvas-container';

// A status, not a dialog: announced but never takes focus, and stays until
// dismissed. Inside a dialog it stays in the dialog's DOM even when hung by
// its control, so the focus trap and Escape still cover it.
export default function TipCard({ inModal }) {
  const { t } = useTranslation();
  const { activeTip, tourTips, touring, stepTour, dismissTip, disableTips } =
    useTips();
  const { showFiltersModal, showDownloadModal } = useUI();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const [openedTip, setOpenedTip] = useState(null);

  const tipModal = TIP_MODALS[activeTip];
  const shown =
    Boolean(activeTip) &&
    (inModal
      ? tipModal === inModal
      : !{ filters: showFiltersModal, download: showDownloadModal }[tipModal]);
  const waiting = isMobile && !touring && !inModal && openedTip !== activeTip;
  const open = shown && !waiting;
  const targets = useTipTargets(open, Boolean(inModal));

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
      if (
        !step ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.target.closest?.(OWNS_ARROWS)
      ) {
        return;
      }
      event.preventDefault();
      stepTour(step);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, stepTour]);

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
      // Stepping the tour shouldn't count as an outside click (useOutsideAlerter).
      onMouseDown={inModal ? (e) => e.stopPropagation() : undefined}
    >
      <div className="tipCardHeader">
        <Lightbulb className="tipCardIcon" size={16} aria-hidden="true" />
        <span className="tipCardHeading">
          {t("tipCounter", {
            n: tourTips.indexOf(activeTip) + 1,
            total: tourTips.length,
          })}
        </span>
        <button
          type="button"
          className="tipCardStep"
          title={`${t("tipPrevious")} (←)`}
          aria-label={t("tipPrevious")}
          aria-keyshortcuts="ArrowLeft"
          onClick={() => stepTour(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="tipCardStep"
          title={`${t("tipNext")} (→)`}
          aria-label={t("tipNext")}
          aria-keyshortcuts="ArrowRight"
          onClick={() => stepTour(1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <CloseButton label={t("tipCardClose")} onClick={dismissTip} />
      </div>
      <p className="tipCardText">
        <TipText tip={activeTip} />
      </p>
      <div className="tipCardFooter">
        {!touring && (
          <button type="button" className="tipCardLink" onClick={disableTips}>
            {t("tipsDisable")}
          </button>
        )}
        {/* Screen readers get the keys from aria-keyshortcuts. */}
        <span className="tipCardKeys" aria-hidden="true">
          <Trans
            i18nKey="tipKeysHint"
            components={{ prev: <kbd />, next: <kbd /> }}
          />
        </span>
      </div>
      <TipPointer targets={targets} inModal={Boolean(inModal)} />
    </div>
  );
}
