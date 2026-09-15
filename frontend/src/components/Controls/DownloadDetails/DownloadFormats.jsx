import * as React from "react";
import { useTranslation } from "react-i18next";

import SelectPill from "../../ui/SelectPill.jsx";
import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import { ERDDAP_FORMATS, OBIS_FORMATS } from "../../../downloadLinks.js";

/*
 * What the direct links on the cards below return: one picker per catalogue in
 * the selection, because ERDDAP and OBIS do not serve the same formats and the
 * OBIS choice is not even a format choice (see OBIS_FORMATS — the two options
 * trade filtering against completeness).
 *
 * A picker only appears while the selection actually holds data from that
 * catalogue, and the group goes away when nothing in the selection can be
 * linked to. It shares the settings band with FilterDownloadToggles: both are
 * settings the list below answers to, so they sit on one row of chrome.
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

  return (
    <div className="downloadBandGroup downloadFormats">
      <span className="downloadBandLabel">
        {t("downloadFormatsSectionTitle")}
        <QuestionIconTooltip
          tooltipText={t("downloadFormatsQuestionTooltipText")}
          tooltipPlacement={"right"}
          size={16}
        />
      </span>
      <div className="downloadBandContent">
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
          <SelectPill
            label={t("directLinksObisFormatLabel")}
            value={obisFormat}
            options={OBIS_FORMATS}
            onChange={setObisFormat}
            data-testid="direct-links-obis-format"
          />
        )}
      </div>
    </div>
  );
}
