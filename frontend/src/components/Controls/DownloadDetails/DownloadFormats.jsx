import * as React from "react";
import { useTranslation } from "react-i18next";

import SelectPill from "../../ui/SelectPill.jsx";
import { ERDDAP_FORMATS, OBIS_FORMATS } from "../../../downloadLinks.js";
import "./styles.css";

/*
 * What file every link in this modal asks for — one setting per source.
 *
 * It sits on the datasets toolbar rather than in the direct-links column
 * because it governs more than that column: DownloadDetails builds one set of
 * links from it and hands them both to the export buttons below and to the
 * "Download CSV" button on every card in the list. Set to Parquet inside a
 * panel labelled "Direct links", it silently relabelled forty buttons
 * elsewhere on the screen; above the list, it reads as what it is — a setting
 * for everything under it.
 *
 * Which pickers appear at all follows the selection: a basket of only OBIS
 * occurrences has no use for a tabledap format, and vice versa.
 */
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
