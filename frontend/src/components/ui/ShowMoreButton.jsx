import * as React from "react";
import classNames from "classnames";
import { useTranslation } from "react-i18next";

import Button from "./Button.jsx";
import "./showMoreButtonStyles.css";

// The "+N" that unfolds the rest of a clipped list of chips, and folds it
// back. Renders nothing when nothing is hidden and the list is folded.
export default function ShowMoreButton({
  expanded,
  hidden,
  total,
  onToggle,
  className,
}) {
  const { t } = useTranslation();
  if (!(hidden > 0 || expanded)) return null;
  return (
    <Button
      className={classNames("listCardTagsMore", className)}
      onPress={onToggle}
      aria-expanded={expanded}
      title={
        expanded
          ? t("listCardTagsFewerText")
          : total != null
            ? t("listCardTagsMoreTitle", { total })
            : undefined
      }
    >
      {expanded ? t("listCardTagsFewerText") : `+${hidden}`}
    </Button>
  );
}
