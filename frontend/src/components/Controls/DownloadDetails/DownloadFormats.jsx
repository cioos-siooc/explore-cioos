import * as React from "react";
import { useTranslation } from "react-i18next";

import SelectPill from "../../ui/SelectPill.jsx";
import { ERDDAP_FORMATS, OBIS_FORMATS } from "../../../downloadLinks.js";
import "./styles.css";

export default function DownloadFormats({
  links,
  erddapFormat,
  setErddapFormat,
  obisFormat,
  setObisFormat,
}) {
  const { t } = useTranslation();

  const hasErddap = links.some((link) => link.source === "erddap");
  const hasObis = links.some((link) => link.source === "obis");
  if (!hasErddap && !hasObis) return null;

  const obisNoteKey = OBIS_FORMATS.find(
    (format) => format.id === obisFormat,
  )?.noteKey;

  return (
    <div className="downloadFormats" data-testid="download-formats">
      {hasErddap && (
        <SelectPill
          label={t("downloadFormatErddapLabel")}
          value={erddapFormat}
          options={ERDDAP_FORMATS}
          onChange={setErddapFormat}
          data-testid="direct-links-erddap-format"
        />
      )}
      {hasObis && (
        <span className="downloadFormatsObis">
          <SelectPill
            label={t("downloadFormatObisLabel")}
            value={obisFormat}
            options={OBIS_FORMATS}
            onChange={setObisFormat}
            data-testid="direct-links-obis-format"
          />
          {obisNoteKey && (
            <span className="downloadFormatsObisNote">{t(obisNoteKey)}</span>
          )}
        </span>
      )}
    </div>
  );
}
