import React, { useRef } from "react";
import { ExclamationTriangle, ArrowClockwise } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import { useFilters } from "../../state/filters/FilterProvider.jsx";
import { useMapState } from "../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../state/selection/SelectionProvider.jsx";
import usePublishedFootprint from "../../state/ui/usePublishedFootprint.js";

// Includes the time-bar clearance, so a surface stacking on the banner reads
// this figure alone.
const BANNER_STACK_GAP = 8;
function measureBannerSpace({ top }) {
  return window.innerHeight - top + BANNER_STACK_GAP;
}

// Otherwise the filters and dataset list would sit silently empty.
export default function ApiErrorBanner() {
  const { catalogError, catalogErrorDetail, loadCatalog } = useFilters();
  const { loadLegend } = useMapState();
  const { pointsError, retryPointQuery } = useSelection();

  if (!catalogError && !pointsError) return null;
  return (
    <BannerSurface
      text={
        catalogError
          ? catalogErrorDetail
            ? "apiErrorRejectedText"
            : "apiErrorBannerText"
          : "apiErrorPointsBannerText"
      }
      detail={catalogError ? catalogErrorDetail : null}
      onRetry={() => {
        if (catalogError) {
          loadCatalog();
          loadLegend();
        }
        if (pointsError) retryPointQuery();
      }}
    />
  );
}

// Split out so the footprint property is cleared when the banner unmounts.
function BannerSurface({ text, detail, onRetry }) {
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
      <span>
        {t(text)}
        {detail && <code className="apiErrorDetail">{detail}</code>}
      </span>
      <button type="button" onClick={onRetry}>
        <ArrowClockwise size={14} aria-hidden="true" />
        {t("apiErrorRetryButton")}
      </button>
    </div>
  );
}
