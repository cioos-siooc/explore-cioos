import * as React from "react";
import { lazy, Suspense } from "react";
import classNames from "classnames";

import "./dateFieldStyles.css";

// The react-aria date stack (every calendar system included) is the largest
// piece of react-aria, and no date field shows on first paint: it loads on
// demand, and at idle once the app is up (see preloadDateField).
const loadInput = () => import("./DateFieldInput.jsx");
const DateFieldInput = lazy(loadInput);

export function preloadDateField() {
  loadInput();
}

// Only a complete, real, in-range date commits; the segments hold anything
// short of one (a year typed digit by digit passes through 0002, 0020, 0201).
export function isCommittable(value, min, max) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  if (Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) return false;
  return (!min || value >= min) && (!max || value <= max);
}

// ISO yyyy-mm-dd in and out, typed in year/month/day segments: the Canadian
// order (-CA) in either language, whatever the browser's locale. A finished
// in-range date commits at once; anything else is undone on blur. Until it
// loads, the same box shows the date as text.
export default function DateField(props) {
  const className = props.className || "railValueInput timeRailDateInput";
  return (
    <Suspense
      fallback={
        <span className={classNames("cioosDateInput", className)}>
          {props.value}
        </span>
      }
    >
      <DateFieldInput {...props} />
    </Suspense>
  );
}
