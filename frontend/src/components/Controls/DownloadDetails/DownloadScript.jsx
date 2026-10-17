import * as React from "react";
import { useTranslation } from "react-i18next";
import { FiletypePy } from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { useTips } from "../../../state/tips/TipsProvider.jsx";
import "./styles.css";

// The script is the queued package run on the user's computer (web-api
// GET /download/script), so it takes the package's format and has no size
// ceiling.
export default function DownloadScript({ url, count }) {
  const { t } = useTranslation();
  const { tipHighlight } = useTips();

  return (
    <div
      className="directLinksGroup"
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
        <span className="directLinksCount">
          {count ? t("downloadScriptCount", { count }) : t("directLinksEmpty")}
        </span>
      </span>

      {count > 0 && (
        <div className="directLinksActions">
          <a className="directLinksButton" href={url} download>
            <FiletypePy size={16} aria-hidden="true" />
            {t("downloadScriptSave")}
          </a>
        </div>
      )}

      <p className="directLinksNotes">
        {t("downloadScriptUsage")}{" "}
        <a
          href="https://docs.astral.sh/uv/getting-started/installation/"
          target="_blank"
          rel="noreferrer"
        >
          {t("downloadScriptUvLink")}
        </a>
      </p>
    </div>
  );
}
