import React, { useRef } from "react";
import { ExclamationTriangle, ArrowClockwise } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { useFilters } from "../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../state/map/MapStateProvider.jsx";
import usePublishedFootprint from "../../state/ui/usePublishedFootprint.js";

// How far up the bottom centre the banner reaches, plus a gap — already
// including whatever it is itself holding off the time bar, so a surface
// stacking on top of it reads this figure alone (see ActivityIndicator).
const BANNER_STACK_GAP = 8;
function measureBannerSpace({ top }) {
  return window.innerHeight - top + BANNER_STACK_GAP;
}

// Shown when the catalog fetches failed (e.g. API gateway timeouts): the
// filters and dataset list would otherwise sit silently empty.
export default function ApiErrorBanner() {
  const { catalogError, loadCatalog } = useFilters();
  const { loadLegend } = useMapState();

  return catalogError ? (
    <BannerSurface
      onRetry={() => {
        loadCatalog();
        loadLegend();
      }}
    />
  ) : null;
}

// Split out so the footprint is published by a component that only exists
// while the banner does: the property is cleared on unmount, and whatever was
// stacking on the banner drops back onto the time bar.
function BannerSurface({ onRetry }) {
  const { t } = useTranslation();
  const bannerRef = useRef(null);
  usePublishedFootprint(
    bannerRef,
    "--cioos-api-error-space",
    measureBannerSpace,
  );

  return (
    <div className="apiErrorBanner" role="alert" ref={bannerRef}>
      <ExclamationTriangle size={18} aria-hidden="true" />
      <span>{t("apiErrorBannerText")}</span>
      <button type="button" onClick={onRetry}>
        <ArrowClockwise size={14} aria-hidden="true" />
        {t("apiErrorRetryButton")}
      </button>
    </div>
  );
}
