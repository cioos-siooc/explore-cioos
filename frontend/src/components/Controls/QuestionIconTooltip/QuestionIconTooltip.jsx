import classNames from "classnames";
import * as React from "react";
import { QuestionCircle } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import Tooltip from "../../ui/Tooltip.jsx";

export default function QuestionIconTooltip({
  tooltipText,
  tooltipPlacement,
  size,
  className = "",
}) {
  const { t } = useTranslation();
  return (
    <Tooltip
      key={tooltipText}
      placement={tooltipPlacement}
      content={tooltipText}
    >
      <QuestionCircle
        role="img"
        aria-label={t("helpIconLabel")}
        className={classNames("helpIcon", className)}
        color="var(--cioos-primary-800)"
        size={size}
      />
    </Tooltip>
  );
}
