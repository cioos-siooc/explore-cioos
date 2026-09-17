import * as React from "react";
import { Globe, InfoCircle, Map } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CioosLogo from "../../ui/CioosLogo.jsx";
import FeedbackButton from "../../Controls/FeedbackButton/FeedbackButton.jsx";
import LanguageSelector from "../../Controls/LanguageSelector/LanguageSelector.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The brand card: logo, the two-line app title lockup, and the minor actions
// (intro / projection / feedback / language) on the top row. The logo is drawn
// rather than loaded, and is also the app's loading indicator — see CioosLogo.
// The
// centered top bar passes the merged Datasets/Filters control in as children,
// so it renders as a second row welded into this same card.
export default function BrandSearch({ children }) {
  const { t, i18n } = useTranslation();
  const { setShowIntroModal } = useUI();
  const { projection, setProjection } = useMapState();

  const isFrench = i18n.language === "fr";
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
          <CioosLogo className="brandLogo" />
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
              className="brandMinorItem"
              onClick={() => setShowIntroModal(true)}
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
            <FeedbackButton className="brandMinorItem" size={20} />
            <LanguageSelector className="brandMinorItem brandLanguage" />
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
