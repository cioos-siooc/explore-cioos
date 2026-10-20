import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Clipboard,
  Download,
  FiletypeCsv,
  FiletypePy,
  FiletypeSh,
  FiletypeTxt,
} from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { Dropdown, DropdownButton } from "../../ui/Dropdown.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import useCopyToClipboard from "../../../state/useCopyToClipboard.js";
import {
  downloadTextFile,
  filterSummaryText,
  linksToCsv,
  linksToCurlScript,
  linksToText,
  saveUrl,
} from "../../../downloadLinks.js";
import "./styles.css";

// Everything the user runs themselves, in one menu. The Python script is the
// queued package run on their computer (web-api GET /download/script); the
// rest are the raw source URLs, offered only without a polygon filter: ERDDAP
// can only take its bounding box, so those files would hold data the package
// filters out.
export default function DownloadScript({
  url,
  count,
  links,
  constraints,
  polygonFiltered,
}) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();
  const [copyState, copy] = useCopyToClipboard("direct download links");

  const depthDropped = links.filter((link) => link.depthDropped).length;
  const obis = links.filter((link) => link.source === "obis").length;

  const exportMeta = {
    generatedAt: new Date().toISOString(),
    filterSummary: filterSummaryText(constraints),
  };
  const stem = `cioos-direct-links-${exportMeta.generatedAt.slice(0, 10)}`;

  return (
    <div
      className="downloadDeliveryOption"
      data-testid="download-script"
      data-tip-highlight={tipHighlight("directLinks")}
    >
      <span className="downloadFooterTitle">
        {t("downloadScriptTitle")}
        <QuestionIconTooltip
          tooltipText={t("downloadScriptTooltipText")}
          tooltipPlacement="top"
          size={16}
        />
        {!count && (
          <span className="directLinksCount">{t("directLinksEmpty")}</span>
        )}
      </span>

      <DropdownButton
        title={
          <>
            <Download size={16} aria-hidden="true" />
            {t("downloadScriptSave")}
          </>
        }
        className="directLinksSave"
        toggleClassName="directLinksButton"
        disabled={!count}
        data-testid="download-script-menu"
      >
        <Dropdown.Item onClick={() => saveUrl(url)}>
          <FiletypePy size={16} aria-hidden="true" />
          {t("downloadScriptPython")}
        </Dropdown.Item>
        {links.length > 0 && (
          <>
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
            <Dropdown.Item onClick={() => copy(linksToText(links))}>
              <Clipboard size={16} aria-hidden="true" />
              {t("directLinksCopy")}
            </Dropdown.Item>
          </>
        )}
      </DropdownButton>

      {/* The menu closes on click, so a copy's result is told here. */}
      <div className="directLinksNotes" aria-live="polite">
        <span>
          {t("downloadScriptUsage")}{" "}
          <a
            href="https://docs.astral.sh/uv/getting-started/installation/"
            target="_blank"
            rel="noreferrer"
          >
            {t("downloadScriptUvLink")}
          </a>
        </span>
        {copyState === "copied" && <span>{t("directLinksCopied")}</span>}
        {copyState === "failed" && <span>{t("directLinksCopyFailed")}</span>}
        {polygonFiltered && <span>{t("downloadScriptPolygonNote")}</span>}
        {depthDropped > 0 && (
          <span>{t("directLinksNoteDepth", { count: depthDropped })}</span>
        )}
        {obis > 0 && <span>{t("directLinksNoteObis", { count: obis })}</span>}
      </div>
    </div>
  );
}
