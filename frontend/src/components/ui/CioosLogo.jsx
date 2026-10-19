import * as React from "react";
import { useTranslation } from "react-i18next";

import Spinner from "./Spinner.jsx";
import { useActivity } from "../../state/activity/ActivityProvider.jsx";
import "./cioosLogoStyles.css";

// Live text rather than the wordmark PNGs so it scales, switches language and
// is screen-readable; the mark doubles as the app's loading indicator. See
// cioosLogoStyles.css for the type matching. 'stacked' (splash) always
// animates, since it renders outside AppProviders; 'inline' (brand card) moves
// only while work is in flight.
export default function CioosLogo({ layout = "inline", className = "" }) {
  const { t } = useTranslation();
  const { announced } = useActivity();
  const stacked = layout === "stacked";
  const idle = !stacked && !announced;

  return (
    <span
      className={`cioosLogo cioosLogo-${layout}${
        idle ? " cioosLogo-idle" : ""
      } ${className}`.trim()}
    >
      {stacked ? (
        <span className="cioosSpinnerDisc">
          <Spinner size="lg" role="presentation" />
        </span>
      ) : (
        <Spinner size="md" role="presentation" />
      )}
      <span className="cioosLogoWordmark">
        <span className="cioosLogoName">{t("brandName")}</span>
        {stacked && (
          <span className="cioosLogoFullName">{t("brandFullName")}</span>
        )}
      </span>
    </span>
  );
}
