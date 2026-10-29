import * as React from "react";
import { useTranslation } from "react-i18next";

import QuestionIconTooltip from "../QuestionIconTooltip/QuestionIconTooltip.jsx";
import SelectPill from "../../ui/SelectPill.jsx";
import {
  OBIS_FORMATS,
  PACKAGE_FORMATS,
  useDownload,
} from "../../../state/download/DownloadProvider.jsx";
import "./styles.css";

// Above both delivery options, not inside either: the emailed package, the
// script and the ERDDAP direct links all take these formats. A source's
// picker shows only when the selection holds one of its datasets.
export default function DownloadFormat({ erddapCount, obisCount }) {
  const { t } = useTranslation();
  const { packageFormat, setPackageFormat, obisFormat, setObisFormat } =
    useDownload();
  const options = (formats) =>
    formats.map((id) => ({ id, label: t(`downloadPackageFormat_${id}`) }));

  return (
    <div className="downloadBandGroup">
      <span className="downloadBandLabel">
        {t("downloadPackageFormatLabel")}
        <QuestionIconTooltip
          tooltipText={t("downloadPackageFormatTooltipText")}
          tooltipPlacement="top"
          size={16}
        />
      </span>
      <div className="downloadBandContent">
        {erddapCount > 0 && (
          <SelectPill
            label="ERDDAP™"
            value={packageFormat}
            options={options(PACKAGE_FORMATS)}
            onChange={setPackageFormat}
            data-testid="download-package-format"
          />
        )}
        {obisCount > 0 && (
          <SelectPill
            label="OBIS"
            value={obisFormat}
            options={options(OBIS_FORMATS)}
            onChange={setObisFormat}
            data-testid="download-obis-format"
          />
        )}
      </div>
    </div>
  );
}
