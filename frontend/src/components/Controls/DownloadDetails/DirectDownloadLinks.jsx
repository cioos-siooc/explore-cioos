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

// Links are built by DownloadDetails, which hands the same set to the cards.
export default function DirectDownloadLinks({
  links,
  constraints,
  formatControls,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();
  const [copyState, copy] = useCopyToClipboard("direct download links");

  const depthDropped = links.filter((link) => link.depthDropped).length;
  const polygonSquared = links.some((link) => link.polygonSquared);
  const unfiltered = links.filter((link) => link.unfiltered).length;

  const exportMeta = {
    generatedAt: new Date().toISOString(),
    filterSummary: filterSummaryText(constraints),
  };
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
        {/* Not a menu item: its label flashes the result, which a menu that
            closes on click could not show. */}
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

      {/* The squared-off polygon is a warning, not a footnote: the file holds
          data the user did not ask for. */}
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
