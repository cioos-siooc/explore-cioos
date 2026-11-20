import * as React from "react";
import { Switch as AriaSwitch } from "react-aria-components";
import classNames from "classnames";

import { useTips } from "../../state/tips/TipsProvider.jsx";
import withTitle from "./withTitle.js";
import "./switchStyles.css";

const TitledSwitch = withTitle(AriaSwitch, "label");

// `title` doubles as the accessible name when there is no visible label.
// `tipTarget` names the contextual tip that points at it (see TipsProvider).
// `onChange` is handed the new state. `children` replace the label and come
// before the track, for a whole card that toggles.
export default function Switch({
  label,
  title,
  checked,
  disabled,
  onChange,
  tipTarget,
  className,
  children,
  ...props
}) {
  const { tipHighlight } = useTips();
  return (
    <TitledSwitch
      className={classNames("form-check form-switch", className)}
      data-tip-highlight={tipHighlight(tipTarget)}
      title={title}
      aria-label={label || props["aria-labelledby"] ? undefined : title}
      isSelected={Boolean(checked)}
      isDisabled={disabled}
      onChange={onChange}
      {...props}
    >
      {children}
      <span className="form-check-input" aria-hidden="true" />
      {label && <span className="form-check-label">{label}</span>}
    </TitledSwitch>
  );
}
