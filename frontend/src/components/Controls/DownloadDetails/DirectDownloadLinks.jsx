import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Clipboard,
  ClipboardCheck,
  FiletypeCsv,
  FiletypeSh,
  FiletypeTxt,
} from "react-bootstrap-icons";

import SelectPill from "../../ui/SelectPill.jsx";
import Switch from "../../ui/Switch.jsx";
import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import reportError from "../../../state/reportError.js";
import {
  ERDDAP_FORMATS,
  OBIS_FORMATS,
  buildDownloadLinks,
  defaultErddapFormat,
  defaultObisFormat,
  downloadConstraints,
  downloadTextFile,
  filterSummaryText,
  linksToCsv,
  linksToCurlScript,
  linksToText,
} from "../../../downloadLinks.js";
import "./styles.css";

/*
 * The second way out of the download modal, on the same page as the first.
 *
 * The order bar above delivers the selection as a zip, by email, from the CDE's
 * own queue. This strip delivers the same selection as URLs the user fetches
 * themselves, straight from the publishing server. They are two shipping
 * options for one order, not two modes of the modal, so they sit one above the
 * other rather than behind tabs: nothing here changes what the queue would
 * send, and a user comparing the two can read both at once.
 *
 * Everything the links say is derived — the rows, the map's filters, the two
 * format choices. The only state is the choices themselves.
 */
export default function DirectDownloadLinks({
  rows,
  query,
  polygon,
  filterDownloadByTime,
  filterDownloadByDepth,
  filterDownloadByPolygon,
}) {
  const { t } = useTranslation();
  const [erddapFormat, setErddapFormat] = useState(defaultErddapFormat);
  const [obisFormat, setObisFormat] = useState(defaultObisFormat);
  const [includeCatalogue, setIncludeCatalogue] = useState(false);
  // "Copied" has to be visible for a moment and then not: the clipboard gives
  // no other sign that the click did anything.
  const [copyState, setCopyState] = useState(null);
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const constraints = useMemo(
    () =>
      downloadConstraints({
        query,
        polygon,
        byTime: filterDownloadByTime,
        byDepth: filterDownloadByDepth,
        byPolygon: filterDownloadByPolygon,
      }),
    [
      query,
      polygon,
      filterDownloadByTime,
      filterDownloadByDepth,
      filterDownloadByPolygon,
    ],
  );

  const links = useMemo(
    () => buildDownloadLinks(rows, { erddapFormat, obisFormat }, constraints),
    [rows, erddapFormat, obisFormat, constraints],
  );

  // Which pickers to show at all: a selection of only OBIS occurrences has no
  // use for a tabledap format, and vice versa.
  const hasErddap = links.some((link) => link.source === "erddap");
  const hasObis = links.some((link) => link.source === "obis");
  const hasCatalogue = links.some((link) => link.ckanRecordUrl);
  const obisNoteKey = OBIS_FORMATS.find(
    (format) => format.id === obisFormat,
  )?.noteKey;

  // What the links could not carry — counted rather than listed, because the
  // rows they belong to are in the table directly above.
  const depthDropped = links.filter((link) => link.depthDropped).length;
  const polygonSquared = links.some((link) => link.polygonSquared);
  const unfiltered = links.filter((link) => link.unfiltered).length;

  const exportMeta = {
    generatedAt: new Date().toISOString(),
    filterSummary: filterSummaryText(constraints),
    includeCatalogue,
  };
  // One stem for all three files so a folder of exports sorts together.
  const stem = `cioos-direct-links-${exportMeta.generatedAt.slice(0, 10)}`;

  function flashCopy(state) {
    setCopyState(state);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyState(null), 2000);
  }

  function handleCopy() {
    // The clipboard API is secure-context only, so over plain http there is no
    // navigator.clipboard to call. Either way the button says so rather than
    // appearing to have worked — the three file buttons still do.
    if (!navigator.clipboard) {
      flashCopy("failed");
      return;
    }
    navigator.clipboard
      .writeText(linksToText(links, { includeCatalogue }))
      .then(() => flashCopy("copied"))
      .catch((error) => {
        reportError("copying direct download links failed", error);
        flashCopy("failed");
      });
  }

  const disabled = links.length === 0;

  return (
    <div className="directLinks" data-testid="direct-links">
      <div className="directLinksIntro">
        <span className="directLinksTitle">
          {t("directLinksTitle")}
          <QuestionIconTooltip
            tooltipText={t("directLinksTooltipText")}
            tooltipPlacement="top"
            size={16}
          />
        </span>
        <span className="directLinksCount">
          {disabled
            ? t("directLinksEmpty")
            : t("directLinksCount", { count: links.length })}
        </span>
      </div>

      <div className="directLinksControls">
        {hasErddap && (
          <SelectPill
            label={t("directLinksErddapFormatLabel")}
            value={erddapFormat}
            options={ERDDAP_FORMATS}
            onChange={setErddapFormat}
            data-testid="direct-links-erddap-format"
          />
        )}
        {hasObis && (
          <span className="directLinksObis">
            <SelectPill
              label={t("directLinksObisFormatLabel")}
              value={obisFormat}
              options={OBIS_FORMATS}
              onChange={setObisFormat}
              data-testid="direct-links-obis-format"
            />
            {obisNoteKey && (
              <span className="directLinksObisNote">{t(obisNoteKey)}</span>
            )}
          </span>
        )}
        {hasCatalogue && (
          <Switch
            id="directLinksCatalogue"
            label={t("directLinksCatalogueLabel")}
            title={t("directLinksCatalogueTooltipText")}
            checked={includeCatalogue}
            onChange={() => setIncludeCatalogue(!includeCatalogue)}
            data-testid="direct-links-catalogue"
          />
        )}
      </div>

      <div className="directLinksActions">
        <button
          type="button"
          className="directLinksButton"
          disabled={disabled}
          onClick={handleCopy}
        >
          {copyState === "copied" ? (
            <ClipboardCheck size={16} aria-hidden="true" />
          ) : (
            <Clipboard size={16} aria-hidden="true" />
          )}
          {copyState === "copied"
            ? t("directLinksCopied")
            : copyState === "failed"
              ? t("directLinksCopyFailed")
              : t("directLinksCopy")}
        </button>
        <button
          type="button"
          className="directLinksButton"
          disabled={disabled}
          onClick={() =>
            downloadTextFile(
              `${stem}.sh`,
              linksToCurlScript(links, exportMeta),
              "text/x-shellscript",
            )
          }
        >
          <FiletypeSh size={16} aria-hidden="true" />
          {t("directLinksScript")}
        </button>
        <button
          type="button"
          className="directLinksButton"
          disabled={disabled}
          onClick={() =>
            downloadTextFile(`${stem}.txt`, linksToText(links, exportMeta))
          }
        >
          <FiletypeTxt size={16} aria-hidden="true" />
          {t("directLinksText")}
        </button>
        <button
          type="button"
          className="directLinksButton"
          disabled={disabled}
          onClick={() =>
            downloadTextFile(
              `${stem}.csv`,
              linksToCsv(links, { includeCatalogue }),
              "text/csv",
            )
          }
        >
          <FiletypeCsv size={16} aria-hidden="true" />
          {t("directLinksCsv")}
        </button>
      </div>

      {/* Each caveat is about the links as built, so it is read after them.
          aria-live because the set changes when a format or filter does. */}
      <div className="directLinksNotes" aria-live="polite">
        {polygonSquared && <span>{t("directLinksNotePolygon")}</span>}
        {depthDropped > 0 && (
          <span>{t("directLinksNoteDepth", { count: depthDropped })}</span>
        )}
        {unfiltered > 0 && (
          <span>{t("directLinksNoteUnfiltered", { count: unfiltered })}</span>
        )}
      </div>
    </div>
  );
}
