import * as React from "react";
import { Globe, InfoCircle, Map } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CioosLogo from "../../ui/CioosLogo.jsx";
import LanguageSelector from "../../Controls/LanguageSelector/LanguageSelector.jsx";
import FeedbackButton from "../../Controls/FeedbackButton/FeedbackButton.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The top bar passes the Datasets/Filters control in as children, welded in as
// a second row of this card.

export default function BrandSearch({ children }) {
  const { t, i18n } = useTranslation();
  const { showIntroModal, setShowIntroModal } = useUI();
  const { projection, setProjection } = useMapState();

  const isFrench = i18n.language === "fr";
  // SIOOC at its own French domain (IntroModal sends both to the English one).
  const websiteUrl = isFrench ? "https://siooc.ca/" : "https://cioos.ca/";
  const globeOn = projection === "globe";
  // The icon is the other projection, not the current one.
  const projectionLabel = t(
    globeOn ? "projectionToggleToMap" : "projectionToggleToGlobe",
  );

  return (
    <div className="brandSearch">
      <div className="brandCard">
        <div className="brandCardTop">
          <a
            className="brandLogo"
            href={websiteUrl}
            target="_blank"
            rel="noreferrer"
            title={t("CIOOSLogoButtonTitle")}
          >
            <CioosLogo />
          </a>
          <h1 className="brandTitle" lang={isFrench ? "fr" : "en"}>
            {isFrench ? (
              <>
                <em>EXPLORATEUR</em>
                <span>DE DONNÉES</span>
              </>
            ) : (
              <>
                <span>DATA</span>
                <em>EXPLORER</em>
              </>
            )}
          </h1>
          <div className="brandMinorItems">
            <FeedbackButton
              className="brandMinorItem brandFeedback"
              size={20}
            />
            <button
              type="button"
              className={classNames("brandMinorItem", {
                active: showIntroModal,
              })}
              onClick={() => setShowIntroModal(true)}
              aria-pressed={showIntroModal}
              title={t("dockIntroButtonTitle")}
              aria-label={t("dockIntroButtonTitle")}
            >
              <InfoCircle size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="brandMinorItem"
              onClick={() => setProjection(globeOn ? "mercator" : "globe")}
              title={projectionLabel}
              aria-label={projectionLabel}
            >
              {globeOn ? (
                <Map size={20} aria-hidden="true" />
              ) : (
                <Globe size={20} aria-hidden="true" />
              )}
            </button>
            <LanguageSelector className="brandMinorItem brandLanguage" />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
