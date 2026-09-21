import * as React from "react";
import { Globe, InfoCircle, Map } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import CioosLogo from "../../ui/CioosLogo.jsx";
import LanguageSelector from "../../Controls/LanguageSelector/LanguageSelector.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The brand card: logo, the two-line app title lockup, and the minor actions
// (intro / projection / language) on the top row. The logo is drawn rather than
// loaded, and is also the app's loading indicator — see CioosLogo. The
// centered top bar passes the merged Datasets/Filters control in as children,
// so it renders as a second row welded into this same card.
//
// Feedback is not among the minor actions: IntroModal already renders the same
// FeedbackButton, with a line of copy explaining what it is for, so a second
// copy up here was the same action twice.
export default function BrandSearch({ children }) {
  const { t, i18n } = useTranslation();
  const { showIntroModal, setShowIntroModal } = useUI();
  const { projection, setProjection } = useMapState();

  const isFrench = i18n.language === "fr";
  // The org's own site, one per language — CIOOS at the English domain, SIOOC
  // (its French name) at its own. IntroModal's own logo link (see
  // CIOOSLogoButtonTitle there) sends both languages to the English domain;
  // this one splits them since the French domain exists and works.
  const websiteUrl = isFrench ? "https://siooc.ca/" : "https://cioos.ca/";
  const globeOn = projection === "globe";
  // Named by what pressing it does, and drawn as where it takes you — the icon
  // is the other projection, not the current one.
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
          {/* Two-line wordmark; the em word gets the large treatment. */}
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
