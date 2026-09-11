import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  Check2,
  Clipboard,
  FileEarmarkCode,
  FiletypeCsv,
  FiletypeTxt,
} from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import useCopyToClipboard from "../../ui/useCopyToClipboard.js";
import {
  downloadTextFile,
  linksToCsv,
  linksToCurlScript,
  linksToText,
} from "../../../downloadLinks.js";

/*
 * The whole selection's direct links, as one thing to take away: the clipboard,
 * a URL list, a runnable curl script, or a table.
 *
 * It exports every link, not the ticked subset the order bar beside it counts.
 * Those ticks exist to keep an emailed archive under the packager's per-dataset
 * ceiling — they untick a dataset *because* it is too big — and a dataset too
 * big to package is the one a direct link is most useful for. The label says
 * how many links that is, so "all" is never ambiguous about which list it is
 * the whole of.
 */
export default function DownloadExports({ links, constraints }) {
  const { t } = useTranslation();
  const { copy, copiedKey } = useCopyToClipboard();

  if (!links.length) return null;

  // Stamped into the exported files so a script found on disk months later
  // says what it was built from. The filter chips above the list are the live
  // version of the same thing.
  const fileMeta = () => ({
    generatedAt: new Date().toISOString(),
    filterSummary: filterSummary(constraints, t),
  });

  return (
    <div className="downloadExports" data-testid="download-exports">
      <span className="downloadExportsLabel">
        {t("directLinksCountLabel", { count: links.length })}
        <QuestionIconTooltip
          tooltipText={t("directLinksFootnote")}
          tooltipPlacement={"top"}
          size={16}
        />
      </span>
      <div className="downloadExportsButtons">
        <button
          type="button"
          className="downloadExportButton"
          onClick={() => copy("all", linksToText(links))}
        >
          {copiedKey === "all" ? <Check2 size={15} /> : <Clipboard size={15} />}
          {copiedKey === "all"
            ? t("directLinksCopiedLabel")
            : t("directLinksCopyAllLabel")}
        </button>
        <button
          type="button"
          className="downloadExportButton"
          onClick={() =>
            downloadTextFile(
              "cde-download-urls.txt",
              linksToText(links, fileMeta()),
            )
          }
        >
          <FiletypeTxt size={15} />
          {t("directLinksDownloadTxtLabel")}
        </button>
        <button
          type="button"
          className="downloadExportButton"
          onClick={() =>
            downloadTextFile(
              "cde-download.sh",
              linksToCurlScript(links, fileMeta()),
              "text/x-shellscript",
            )
          }
        >
          <FileEarmarkCode size={15} />
          {t("directLinksDownloadScriptLabel")}
        </button>
        <button
          type="button"
          className="downloadExportButton"
          onClick={() =>
            downloadTextFile(
              "cde-download-urls.csv",
              linksToCsv(links),
              "text/csv",
            )
          }
        >
          <FiletypeCsv size={15} />
          {t("directLinksDownloadCsvLabel")}
        </button>
      </div>
    </div>
  );
}

// The filters a generated file was built under, as one line of plain text.
function filterSummary(constraints, t) {
  const parts = [];
  if (constraints.startDate) {
    parts.push(`${constraints.startDate} – ${constraints.endDate}`);
  }
  if (constraints.startDepth != null) {
    parts.push(`${constraints.startDepth} – ${constraints.endDepth} m`);
  }
  if (constraints.bounds) {
    const [[west, south], [east, north]] = constraints.bounds;
    parts.push(
      `bbox ${west.toFixed(3)},${south.toFixed(3)} → ${east.toFixed(
        3,
      )},${north.toFixed(3)}`,
    );
  }
  return parts.join("; ") || t("downloadDetailsNoFiltersActiveMessage");
}
