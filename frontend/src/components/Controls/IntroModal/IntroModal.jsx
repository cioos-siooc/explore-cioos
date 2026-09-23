import * as React from "react";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BarChartLine,
  Bezier2,
  Download,
  GeoAlt,
  GlobeAmericas,
  Grid3x3Gap,
  InfoCircle,
  Lightbulb,
  Search,
  Water,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import CioosLogo from "../../ui/CioosLogo.jsx";
import Modal from "../../ui/Modal.jsx";
import Switch from "../../ui/Switch.jsx";
import FeedbackButton from "../FeedbackButton/FeedbackButton.jsx";
import TipText from "../Tips/TipText.jsx";
import { useFilters } from "../../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";
import { MARKER_MIN_ZOOM } from "../../config.js";
import useMediaQuery from "../../../state/ui/useMediaQuery.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import { TIPS, useTips } from "../../../state/tips/TipsProvider.jsx";
import {
  findTrajectory,
  showGridded,
  showNonna,
  showTrajectory,
} from "../../../state/tips/scenes.js";
import "./styles.css";

// What the tool is for, in the order a newcomer meets it: find data on the
// map, narrow it down, take it away. Each card leads with the glyph of the
// control that does it.
const FEATURES = [
  { key: "explore", Icon: GlobeAmericas },
  { key: "search", Icon: Search },
  { key: "download", Icon: Download },
];

// The Gulf of St. Lawrence, thick with profile and time-series stations. A
// point frames at exactly the camera's maxZoom, just past the zoom where hexes
// give way to markers.
const STATIONS_SHOWCASE_CENTRE = {
  type: "Point",
  coordinates: [-63.914, 49.038],
};
const STATIONS_SHOWCASE_ZOOM = MARKER_MIN_ZOOM + 0.8;

// A few of the app's views, one click away from the intro: each closes the
// dialog and sets the app up the way a user would have, using the same
// actions the controls do. One whose data isn't in the catalogue (no gridded
// dataset with a WMS server, nothing downloadable) is left out.
function useShowcases(close) {
  const {
    pointsData,
    pointsToReview,
    setInspectDataset,
    handleSelectDataset,
    selectTrajectoryFromMap,
  } = useSelection();
  const { zoomToGeometry, setBathymetryVisible } = useMapState();
  const { setShowDownloadModal, setShowCoverageModal } = useUI();

  const gridded = pointsData.find((dataset) => dataset.wms_url);
  const trajectory = findTrajectory(pointsData);
  const downloadable = pointsData.find(
    (dataset) => dataset.cdm_data_type !== "Grid",
  );

  return [
    gridded && {
      key: "wms",
      Icon: Grid3x3Gap,
      run: () => showGridded(gridded, { setInspectDataset, zoomToGeometry }),
    },
    trajectory && {
      key: "trajectory",
      Icon: Bezier2,
      run: () =>
        showTrajectory(trajectory, {
          selectTrajectoryFromMap,
          setInspectDataset,
          zoomToGeometry,
        }),
    },
    {
      key: "stations",
      Icon: GeoAlt,
      run: () =>
        zoomToGeometry(STATIONS_SHOWCASE_CENTRE, {
          maxZoom: STATIONS_SHOWCASE_ZOOM,
        }),
    },
    {
      key: "coverage",
      Icon: BarChartLine,
      run: () => setShowCoverageModal(true),
    },
    downloadable && {
      key: "download",
      Icon: Download,
      run: () => {
        if (!pointsToReview?.length) handleSelectDataset(downloadable);
        setShowDownloadModal(true);
      },
    },
    {
      key: "nonna",
      Icon: Water,
      run: () => showNonna({ setBathymetryVisible, zoomToGeometry }),
    },
  ]
    .filter(Boolean)
    .map((showcase) => ({
      ...showcase,
      run: () => {
        close();
        showcase.run();
      },
    }));
}

const COUNT_UP_MS = 900;

// Counts up to `target` once it is known, so the catalogue's size reads as a
// live figure rather than copy. Lands on it at once when motion is reduced.
function useCountUp(target) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!target || reduced) return undefined;
    let frame;
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / COUNT_UP_MS, 1);
      // Ease out, so the last digits settle rather than stop dead.
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduced]);
  return reduced ? target : value;
}

function Stat({ value, label, language }) {
  const shown = useCountUp(value);
  if (!value) return null;
  return (
    <li className="introStat">
      <span className="introStatValue">{shown.toLocaleString(language)}</span>
      <span className="introStatLabel">{label}</span>
    </li>
  );
}

export default function IntroModal({ showModal, setShowModal }) {
  const { t, i18n } = useTranslation();
  const { setShowSelectionHelpModal } = useUI();
  const { tipsEnabled, setTipsEnabled, startTour } = useTips();
  const {
    totalNumberOfDatasets,
    erddapServersSelected,
    orgsSelected,
    obisDataAvailable,
  } = useFilters();
  const [tipIndex, setTipIndex] = useState(0);
  const close = () => setShowModal(false);
  const showcases = useShowcases(close);

  return (
    <Modal
      show={showModal}
      size="xl"
      centered
      aria-labelledby="introModalTitle"
      onHide={close}
      scrollable
      className="introModal"
      fullscreen="lg-down"
    >
      <Modal.Header closeButton>
        <a
          className="introBrand"
          href={
            i18n.language === "fr" ? "https://siooc.ca/" : "https://cioos.ca/"
          }
          target="_blank"
          rel="noreferrer"
          title={t("CIOOSLogoButtonTitle")}
        >
          <CioosLogo />
        </a>
        <Modal.Title className="introTitle" id="introModalTitle">
          <span className="introEyebrow">{t("dockIntroButtonTitle")}</span>
          <span className="introTitleName">{t("CIOOSDataExplorer")}</span>
          <span className="tagLine">{t("CIOOSQuote")}</span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <section className="introHero">
          <svg
            className="introHeroWaves"
            viewBox="0 0 1200 120"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d="M0 60 C200 20 400 100 600 60 S1000 20 1200 60 V120 H0Z" />
            <path d="M0 80 C200 40 400 120 600 80 S1000 40 1200 80 V120 H0Z" />
          </svg>
          <div className="introHeroCopy">
            <h2 className="introHeroTitle">{t("introHeroTitle")}</h2>
            <p className="introHeroText">{t("introHeroText")}</p>
            <div className="introHeroActions">
              <button type="button" className="introCta" onClick={close}>
                {t("introHeroCta")}
              </button>
              <span className="introSource">ERDDAP™</span>
              {obisDataAvailable && <span className="introSource">OBIS</span>}
            </div>
          </div>
          <ul className="introStats" aria-label={t("introStatsLabel")}>
            <Stat
              value={totalNumberOfDatasets}
              label={t("introStatDatasets")}
              language={i18n.language}
            />
            <Stat
              value={erddapServersSelected?.length}
              label={t("introStatServers")}
              language={i18n.language}
            />
            <Stat
              value={orgsSelected?.length}
              label={t("introStatOrganizations")}
              language={i18n.language}
            />
          </ul>
        </section>

        <ul className="introFeatures">
          {FEATURES.map(({ key, Icon }, index) => (
            <li
              key={key}
              className="introFeature"
              style={{ "--intro-feature-index": index }}
            >
              <span className="introFeatureIcon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <h3>{t(`introFeature_${key}_title`)}</h3>
              <p>{t(`introFeature_${key}_body`)}</p>
              {key === "download" && (
                <button
                  type="button"
                  className="introLink"
                  onClick={() => setShowSelectionHelpModal(true)}
                >
                  {t("sidebarSelectionHintMoreText")}
                </button>
              )}
            </li>
          ))}
        </ul>

        <h2 className="introHeading">{t("introShowcasesHeading")}</h2>
        <ul className="introShowcases">
          {showcases.map(({ key, Icon, run }) => (
            <li key={key}>
              <button type="button" className="introShowcase" onClick={run}>
                <span className="introShowcaseIcon" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <span className="introShowcaseText">
                  <span className="introShowcaseTitle">
                    {t(`introShowcase_${key}_title`)}
                  </span>
                  <span className="introShowcaseBody">
                    {t(`introShowcase_${key}_body`)}
                  </span>
                </span>
                <ArrowRight
                  className="introShowcaseArrow"
                  size={18}
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>

        <footer className="introFooter">
          <section className="introTip" data-testid="intro-tip">
            <h2 className="introTipHeading">
              <Lightbulb size={16} aria-hidden="true" /> {t("tipsHeading")}
            </h2>
            {/* Closes the dialog and pages through the tips on the map, each
                pointing at the control it is about (see startTour). */}
            <button
              type="button"
              key={tipIndex}
              className="introTipShow"
              title={t("tipShowMe")}
              onClick={() => {
                close();
                startTour(TIPS[tipIndex]);
              }}
            >
              <TipText tip={TIPS[tipIndex]} />
              <span className="introTipShowLabel">
                {t("tipShowMe")}
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </button>
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
          </section>
          <div className="introFooterLinks">
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
        </footer>
      </Modal.Body>
    </Modal>
  );
}
