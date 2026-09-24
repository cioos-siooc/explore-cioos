import * as React from "react";
import { useTranslation } from "react-i18next";

import "./activityListStyles.css";

// What the app is waiting on, as a list of named waits. Presentational on
// purpose: both callers — the bottom status panel and the first-paint splash —
// read the activity registry themselves and hand the keys down, so this stays a
// plain list with no state of its own.
//
// Rows carry no mark of their own. Each caller already shows one animation for
// the whole wait — the splash's pulsing lockup, the status panel's spinner
// under its heading — and a copy of it on every row was noise rather than
// information: five marks all saying the same thing the one above them said.
export default function ActivityList({ labelKeys, className = "" }) {
  const { t } = useTranslation();

  if (!labelKeys.length) return null;

  return (
    <ul className={["activityList", className].filter(Boolean).join(" ")}>
      {labelKeys.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}
