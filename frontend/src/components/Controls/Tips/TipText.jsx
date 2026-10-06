import * as React from "react";
import { PlusCircle, SlashCircle } from "react-bootstrap-icons";
import { Trans, useTranslation } from "react-i18next";

import "./styles.css";

// A tip's text, with each control it names by its glyph (<add/>, <exclude/>)
// drawn with that glyph.
export default function TipText({ tip }) {
  const { t } = useTranslation();
  const glyph = (Icon, label) => (
    <Icon className="tipGlyph" size={14} role="img" aria-label={label} />
  );
  return (
    <Trans
      i18nKey={`tip_${tip}`}
      components={{
        add: glyph(PlusCircle, t("datasetsCardSelectForDownloadText")),
        exclude: glyph(SlashCircle, t("filterOptionExcludeAction")),
      }}
    />
  );
}
