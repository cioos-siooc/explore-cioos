import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Clipboard,
  ClipboardCheck,
  ExclamationTriangleFill,
  FiletypeCsv,
  FiletypeSh,
  FiletypeTxt,
} from "react-bootstrap-icons";

import SelectPill from "../../ui/SelectPill.jsx";
import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import useCopyToClipboard from "../../../state/useCopyToClipboard.js";
import {
  ERDDAP_FORMATS,
  OBIS_FORMATS,
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
 * The links themselves are built by DownloadDetails, which also hands them to
 * the card list above so a dataset's card can show the one query it would be
 * fetched with. This strip owns nothing but the copy button's flash: what it
 * exports and what the cards show are the same links.
 */
export default function DirectDownloadLinks({
  links,
  constraints,
  erddapFormat,
  setErddapFormat,
  obisFormat,
  setObisFormat,
}) {
  const { t } = useTranslation();
  const [copyState, copy] = useCopyToClipboard("direct download links");

  // Which pickers to show at all: a selection of only OBIS occurrences has no
  // use for a tabledap format, and vice versa.
  const hasErddap = links.some((link) => link.source === "erddap");
  const hasObis = links.some((link) => link.source === "obis");
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
  };
  // One stem for all three files so a folder of exports sorts together.
  const stem = `cioos-direct-links-${exportMeta.generatedAt.slice(0, 10)}`;

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
      </div>

      <div className="directLinksActions">
        <button
          type="button"
          className="directLinksButton"
          disabled={disabled}
          onClick={() => copy(linksToText(links))}
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
            downloadTextFile(`${stem}.csv`, linksToCsv(links), "text/csv")
          }
        >
          <FiletypeCsv size={16} aria-hidden="true" />
          {t("directLinksCsv")}
        </button>
      </div>

      {/* Each caveat is about the links as built, so it is read after them.
          aria-live because the set changes when a format or filter does.

          The squared-off polygon is the one that changes what arrives rather
          than qualifying it: the file a user opens will hold points they drew
          around, and nothing in the link or the query on the cards above says
          so. The other two describe a link doing less filtering than asked;
          this one describes data the user did not ask for, so it is a warning
          and the others stay footnotes. */}
      <div className="directLinksNotes" aria-live="polite">
        {polygonSquared && (
          <strong className="directLinksWarning" role="alert">
            <ExclamationTriangleFill size={14} aria-hidden="true" />
            {t("directLinksNotePolygon")}
          </strong>
        )}
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
