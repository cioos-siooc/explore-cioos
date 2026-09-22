import * as React from "react";
import { useState } from "react";
import {
  BoundingBox,
  Download,
  Filter,
  InfoCircle,
  Lightbulb,
  ListUl,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import Modal from "../../ui/Modal.jsx";
import Switch from "../../ui/Switch.jsx";
import FeedbackButton from "../FeedbackButton/FeedbackButton.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { TIPS, useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// Each step leads with the glyph the user meets on the control that does it,
// so the explanation and the button are recognisably the same thing.
const STEPS = [
  { key: "Filter", Icon: Filter },
  { key: "Select", Icon: BoundingBox },
  { key: "Inspect", Icon: ListUl },
  { key: "Download", Icon: Download },
];

export default function IntroModal({ showModal, setShowModal }) {
  const { t, i18n } = useTranslation();
  const { setShowSelectionHelpModal } = useUI();
  const { tipsEnabled, setTipsEnabled } = useTips();
  const [step, setStep] = useState(STEPS[0].key);
  const [tipIndex, setTipIndex] = useState(0);

  return (
    <Modal
      show={showModal}
      size="xl"
      centered
      aria-labelledby="introModalTitle"
      onHide={() => setShowModal(false)}
      scrollable
      className="introModal"
      fullscreen="lg-down"
    >
      <Modal.Header closeButton>
        <Modal.Title className="modalHeader" id="introModalTitle">
          <span>{t("CIOOSDataExplorer") + " "}</span>
          <span className="tagLine">{t("CIOOSQuote")}</span>
          <a
            title={t("CIOOSLogoButtonTitle")}
            className={classNames(
              "introLogo",
              i18n.language === "en" ? "english" : "french",
            )}
            href="https://cioos.ca/"
            target="_blank"
            rel="noreferrer"
          />
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="introLead">{t("introModalWelcomeMessage")}</p>

        <h2 className="introHeading">{t("introStepsHeading")}</h2>
        <div className="introSteps" role="group">
          {STEPS.map(({ key, Icon }, index) => (
            <button
              key={key}
              type="button"
              className="introStep"
              aria-pressed={step === key}
              onClick={() => setStep(key)}
            >
              <span className="introStepNumber">{index + 1}</span>
              <Icon size={28} aria-hidden="true" />
              <span>{t(`stepInfo${key}`)}</span>
            </button>
          ))}
        </div>
        <div className="introStepInfo" data-testid="intro-step-info">
          <p>{t(`stepInfo${step}Text`)}</p>
          {step === "Download" && (
            <button
              type="button"
              className="introLink"
              onClick={() => setShowSelectionHelpModal(true)}
            >
              {t("sidebarSelectionHintMoreText")}
            </button>
          )}
        </div>

        <h2 className="introHeading">
          <Lightbulb size={18} aria-hidden="true" /> {t("tipsHeading")}
        </h2>
        <div className="introTip" data-testid="intro-tip">
          <p>{t(`tip_${TIPS[tipIndex]}`)}</p>
          <div className="introTipNav">
            <span className="introTipCount">
              {t("tipCounter", { n: tipIndex + 1, total: TIPS.length })}
            </span>
            <button
              type="button"
              className="introLink"
              onClick={() => setTipIndex((tipIndex + 1) % TIPS.length)}
            >
              {t("tipNext")}
            </button>
          </div>
        </div>

        <div className="introFooter">
          <p>
            <FeedbackButton className="feedbackButton" size={24} />
            {t("tipInfoFeedback")}
          </p>
          <p>
            <InfoCircle
              className="introFooterIcon"
              size={20}
              aria-hidden="true"
            />
            {t("introReopenText")}
          </p>
          <Switch
            id="introTipsToggle"
            label={t("tipsToggleLabel")}
            checked={tipsEnabled}
            onChange={() => setTipsEnabled(!tipsEnabled)}
          />
        </div>
      </Modal.Body>
    </Modal>
  );
}
