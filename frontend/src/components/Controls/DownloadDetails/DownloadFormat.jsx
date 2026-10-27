import * as React from "react";
import { useTranslation } from "react-i18next";
import { ExclamationTriangleFill } from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import {
  ERDDAP_FORMATS,
  OBIS_FORMATS,
  OBIS_VALUES,
  PACKAGE_FORMATS,
  useDownload,
} from "../../../state/download/DownloadProvider.jsx";
import "./styles.css";

// Above both delivery options, not inside either: the emailed package, the
// script and the direct links all take this format.
function formatGroup(id) {
  if (!OBIS_FORMATS.includes(id)) return "downloadPackageFormatGroupErddap";
  if (!ERDDAP_FORMATS.includes(id)) return "downloadPackageFormatGroupObis";
  return "downloadPackageFormatGroupAll";
}

export default function DownloadFormat({ obisCount, erddapCount }) {
  const { t } = useTranslation();
  const { packageFormat, setPackageFormat, obisValues, setObisValues } =
    useDownload();
  const obisFallback = obisCount > 0 && !OBIS_FORMATS.includes(packageFormat);
  const erddapFallback =
    erddapCount > 0 && !ERDDAP_FORMATS.includes(packageFormat);

  return (
    <>
      <div className="downloadFormat">
        <span className="downloadFormatLabel">
          {t("downloadPackageFormatLabel")}
          <QuestionIconTooltip
            tooltipText={t("downloadPackageFormatTooltipText")}
            tooltipPlacement="top"
            size={16}
          />
        </span>
        <SelectPill
          label={t("downloadPackageFormatPillLabel")}
          value={packageFormat}
          options={PACKAGE_FORMATS.map((id) => ({
            id,
            label: t(`downloadPackageFormat_${id}`),
            group: t(formatGroup(id)),
          }))}
          onChange={setPackageFormat}
          data-testid="download-package-format"
        />
        {obisCount > 0 && (
          <SelectPill
            label={t("downloadObisValuesPillLabel")}
            value={obisValues}
            options={OBIS_VALUES.map((id) => ({
              id,
              label: t(`downloadObisValues_${id}`),
            }))}
            onChange={setObisValues}
            data-testid="download-obis-values"
          />
        )}
      </div>
      {obisFallback && (
        <p className="downloadFormatNotice">
          <ExclamationTriangleFill size={14} aria-hidden="true" />
          {t("downloadPackageFormatObisNote", {
            count: obisCount,
            format: t(`downloadPackageFormat_${packageFormat}`),
          })}
        </p>
      )}
      {erddapFallback && (
        <p className="downloadFormatNotice">
          <ExclamationTriangleFill size={14} aria-hidden="true" />
          {t("downloadPackageFormatErddapNote", { count: erddapCount })}
        </p>
      )}
    </>
  );
}
