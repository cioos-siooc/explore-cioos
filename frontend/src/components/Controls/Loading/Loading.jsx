import * as React from "react";

import ActivityList from "../../ui/ActivityList.jsx";
import CioosLogo from "../../ui/CioosLogo.jsx";
import Spinner from "../../ui/Spinner.jsx";
import { useActivity } from "../../../state/activity/ActivityProvider.jsx";
import "./styles.css";

// variant='brand' veils the app rather than hiding it, so the basemap reads
// through; data layers stay at zero opacity until revealData (Map.jsx).
//
// `dismissed` fades the splash instead of the map: MapLibre won't transition
// data-driven opacity, and a transparent WebGL canvas isn't composited. Keep it
// mounted until onDismissed, or the fade is cut short.
export default function Loading({
  variant = "brand",
  dismissed = false,
  onDismissed,
}) {
  // Empty outside AppProviders, where index.jsx's Suspense fallback renders this.
  const { labelKeys } = useActivity();

  if (variant !== "brand") {
    return (
      <div
        className="loading loading-inline"
        data-testid="loading-inline"
        role="status"
      >
        <Spinner />
      </div>
    );
  }

  return (
    <div
      className={`loading loading-brand${dismissed ? " loading-dismissed" : ""}`}
      data-testid="app-splash"
      // The app's longest wait; a silent full-screen cover is a gap for a screen reader.
      role="status"
      // Only the cover's fade: the mark's pulse is an animation, not a transition.
      onTransitionEnd={(event) => {
        if (dismissed && event.propertyName === "opacity") onDismissed?.();
      }}
    >
      {/* The list of waits hangs off the lockup absolutely, so rows arriving and
          finishing never shift the logo. */}
      <div className="loadingBrand">
        <CioosLogo layout="stacked" />
        <ActivityList labelKeys={labelKeys} className="loadingActivity" />
      </div>
    </div>
  );
}
