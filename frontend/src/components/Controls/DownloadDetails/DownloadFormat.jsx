import * as React from "react";
import { useTranslation } from "react-i18next";
import { ExclamationTriangleFill } from "react-bootstrap-icons";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import {
  OBIS_FORMATS,
  PACKAGE_FORMATS,
  useDownload,
} from "../../../state/download/DownloadProvider.jsx";
import "./styles.css";

// Above both delivery options, not inside either: the emailed package, the
// script and the direct links all take this format.
export default function DownloadFormat({ obisCount }) {
  const { t } = useTranslation();
  const { packageFormat, setPackageFormat } = useDownload();
  const obisFallback = obisCount > 0 && !OBIS_FORMATS.includes(packageFormat);

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
            group: t(
              OBIS_FORMATS.includes(id)
                ? "downloadPackageFormatGroupAll"
                : "downloadPackageFormatGroupErddap",
            ),
          }))}
          onChange={setPackageFormat}
          data-testid="download-package-format"
        />
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
    </>
  );
}
