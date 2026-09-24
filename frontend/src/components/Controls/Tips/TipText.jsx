import * as React from "react";
import { Download } from "react-bootstrap-icons";
import { Trans, useTranslation } from "react-i18next";

import "./styles.css";

// A tip's text, with each control it names by its glyph (<download/>) drawn
// with that glyph.
export default function TipText({ tip }) {
  const { t } = useTranslation();
  return (
    <Trans
      i18nKey={`tip_${tip}`}
      components={{
        download: (
          <Download
            className="tipGlyph"
            size={14}
            role="img"
            aria-label={t("downloadModalButtonText")}
          />
        ),
      }}
    />
  );
}
