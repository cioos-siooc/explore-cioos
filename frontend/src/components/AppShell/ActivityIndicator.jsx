import * as React from "react";
import { useTranslation } from "react-i18next";

import ActivityList from "../ui/ActivityList.jsx";
import Spinner from "../ui/Spinner.jsx";
import { useActivity } from "../../state/activity/ActivityProvider.jsx";
import { useMapState } from "../../state/map/MapStateProvider.jsx";
import "./activityIndicatorStyles.css";

// Comes and goes with the work; the brand logo's mark is the standing
// indicator, this names the parts.
export default function ActivityIndicator() {
  const { t } = useTranslation();
  const { labelKeys, busy, announced } = useActivity();
  // The splash names the same waits, so the panel stands down until it has
  // gone. The spoken commentary carries on either way.
  const { firstPaintPending } = useMapState();

  return (
    <div className="activityIndicator">
      {/* `announced` rather than `busy`: a cached filter change resolves inside
          the registry's delay and never flashes the panel open. */}
      {announced && !firstPaintPending && (
        <div className="activityStatus">
          <p className="activityStatusHeading">{t("activityStatusHeading")}</p>
          {/* One mark for the whole panel; `presentation` because the heading
              and rows are the status. */}
          <Spinner size="sm" role="presentation" />
          <ActivityList labelKeys={labelKeys} />
        </div>
      )}
      {/* Spoken whether or not the panel is on screen. */}
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? labelKeys.map((key) => t(key)).join(", ") : ""}
      </span>
    </div>
  );
}
