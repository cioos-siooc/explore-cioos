import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Clipboard,
  ClipboardCheck,
  Download,
  ExclamationTriangleFill,
  FiletypeCsv,
  FiletypeSh,
  FiletypeTxt,
} from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import useCopyToClipboard from "../../../state/useCopyToClipboard.js";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import {
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
 * The column to the left delivers the selection as a zip, by email, from the
 * CDE's own queue. This one delivers the same selection as URLs the user
 * fetches themselves, straight from the publishing server. They are two
 * shipping options for one order, not two modes of the modal, so they sit side
 * by side rather than behind tabs: nothing here changes what the queue would
 * send, and a user comparing the two reads both at once.
 *
 * The links themselves are built by DownloadDetails, which also hands them to
 * the card list above so a dataset's card can show the one query it would be
 * fetched with. The format picker (DownloadFormats) is built there too and
 * only rendered here. This column owns nothing but the copy button's flash:
 * what it exports and what the cards show are the same links.
 */
export default function DirectDownloadLinks({
  links,
  constraints,
  formatControls,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();
  const [copyState, copy] = useCopyToClipboard("direct download links");

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
    <div
      className="downloadFooterSection directLinks"
      data-testid="direct-links"
      data-tip-highlight={tipHighlight("directLinks")}
    >
      <span className="downloadFooterTitle">
        {t("directLinksTitle")}
        <QuestionIconTooltip
          tooltipText={t("directLinksTooltipText")}
          tooltipPlacement="top"
          size={16}
        />
        <span className="directLinksCount">
          {disabled
            ? t("directLinksEmpty")
            : t("directLinksCount", { count: links.length })}
        </span>
      </span>

      {formatControls}

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
        {/* Copy stays a button of its own: its label flashes the result,
            which a menu item that closes on click could not show. */}
        <DropdownButton
          title={
            <>
              <Download size={16} aria-hidden="true" />
              {t("directLinksSave")}
            </>
          }
          className="directLinksSave"
          toggleClassName="directLinksButton"
          align="end"
          disabled={disabled}
          data-testid="direct-links-save"
        >
          <Dropdown.Item
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
          </Dropdown.Item>
          <Dropdown.Item
            onClick={() =>
              downloadTextFile(`${stem}.txt`, linksToText(links, exportMeta))
            }
          >
            <FiletypeTxt size={16} aria-hidden="true" />
            {t("directLinksText")}
          </Dropdown.Item>
          <Dropdown.Item
            onClick={() =>
              downloadTextFile(`${stem}.csv`, linksToCsv(links), "text/csv")
            }
          >
            <FiletypeCsv size={16} aria-hidden="true" />
            {t("directLinksCsv")}
          </Dropdown.Item>
        </DropdownButton>
      </div>

      {/* Each caveat is about the links as built, so it sits at the foot of
          the column they are built in. aria-live because the set changes when
          a format or filter does.

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
