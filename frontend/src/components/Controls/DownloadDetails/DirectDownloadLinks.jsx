import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Clipboard,
  ClipboardCheck,
  Download,
  FiletypeCsv,
  FiletypeSh,
  FiletypeTxt,
} from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import useCopyToClipboard from "../../../state/useCopyToClipboard.js";
import {
  downloadTextFile,
  filterSummaryText,
  linksToCsv,
  linksToCurlScript,
  linksToText,
} from "../../../downloadLinks.js";
import "./styles.css";

// Offered only without a polygon filter: ERDDAP can only take its bounding
// box, so the files would hold data the package filters out.
export default function DirectDownloadLinks({ links, constraints }) {
  const { t } = useTranslation();
  const [copyState, copy] = useCopyToClipboard("direct download links");

  const depthDropped = links.filter((link) => link.depthDropped).length;
  const obis = links.filter((link) => link.source === "obis").length;

  const exportMeta = {
    generatedAt: new Date().toISOString(),
    filterSummary: filterSummaryText(constraints),
  };
  const stem = `cioos-direct-links-${exportMeta.generatedAt.slice(0, 10)}`;

  const disabled = links.length === 0;

  return (
    <div className="directLinksGroup" data-testid="direct-links">
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

      <div className="directLinksNotes" aria-live="polite">
        {depthDropped > 0 && (
          <span>{t("directLinksNoteDepth", { count: depthDropped })}</span>
        )}
        {obis > 0 && <span>{t("directLinksNoteObis", { count: obis })}</span>}
      </div>
    </div>
  );
}
