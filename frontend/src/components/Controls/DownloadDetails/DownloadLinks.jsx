import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FiletypeCsv } from "react-bootstrap-icons";

import { useTips } from "../../../state/tips/TipsProvider.jsx";
import reportError from "../../../state/reportError.js";
import { server } from "../../../config.js";
import { downloadTextFile, linksToCsv } from "../../../downloadLinks.js";
import "./styles.css";

// The raw source links, each flagged with the download filters it leaves out.
export default function DownloadLinks({ count, links, polygonFiltered }) {
  const { t, i18n } = useTranslation();
  const { tipHighlight } = useTips();
  const [state, setState] = useState();

  const leavesOut = (link, filter) => link.unapplied.includes(filter);
  const depthDropped = links.filter(
    (link) => link.source === "erddap" && leavesOut(link, "depth"),
  ).length;
  const obisSubset = links.filter(
    (link) =>
      link.source === "obis" &&
      (leavesOut(link, "time") || leavesOut(link, "depth")),
  ).length;

  async function saveCsv() {
    setState("loading");
    try {
      const pks = links.map((link) => link.pk).join(",");
      const response = await fetch(
        `${server}/datasets/citations?datasetPKs=${pks}&lang=${i18n.language}`,
      );
      if (!response.ok) throw new Error(`citations failed: ${response.status}`);
      const day = new Date().toISOString().slice(0, 10);
      downloadTextFile(
        `cioos-datasets-${day}.csv`,
        linksToCsv(links, await response.json()),
        "text/csv",
      );
      setState();
    } catch (error) {
      reportError("dataset list export failed", error);
      setState("failed");
    }
  }

  return (
    <div
      className="downloadDeliveryOption directLinks"
      data-testid="download-links"
      data-tip-highlight={tipHighlight("directLinks")}
    >
      <span className="downloadFooterTitle">
        {t("directLinksTitle")}
        {!count && (
          <span className="directLinksCount">{t("directLinksEmpty")}</span>
        )}
      </span>
      <p className="directLinksDescription">{t("directLinksDescription")}</p>

      <button
        type="button"
        className="directLinksButton"
        disabled={!links.length || state === "loading"}
        onClick={saveCsv}
      >
        <FiletypeCsv size={16} aria-hidden="true" />
        {t("directLinksCsv")}
      </button>

      <div className="directLinksNotes" aria-live="polite">
        {state === "failed" && <span>{t("directLinksFailed")}</span>}
        {polygonFiltered && links.length > 0 && (
          <span>{t("directLinksPolygonNote")}</span>
        )}
        {depthDropped > 0 && (
          <span>{t("directLinksNoteDepth", { count: depthDropped })}</span>
        )}
        {obisSubset > 0 && (
          <span>{t("directLinksNoteObis", { count: obisSubset })}</span>
        )}
      </div>
    </div>
  );
}
