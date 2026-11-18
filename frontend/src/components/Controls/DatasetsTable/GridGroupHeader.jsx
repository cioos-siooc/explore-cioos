import * as React from "react";
import { ChevronRight, Grid3x3Gap } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

// The one row the gridded datasets fold into, in the datasets list and the
// "what's here" card alike. `here` counts those under the latest map click.
export default function GridGroupHeader({ count, here = 0, open, onToggle }) {
  const { t } = useTranslation();
  const label = t("datasetsCardGridGroupText");
  return (
    <div
      className={classNames("datasetsCardGroupHeader", { open })}
      data-testid="grid-group-header"
    >
      <button
        type="button"
        className="datasetsCardGroupToggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <ChevronRight
          className="datasetsCardGroupCaret"
          size={11}
          aria-hidden="true"
        />
        <Grid3x3Gap
          className="datasetsCardGroupIcon"
          size={13}
          aria-hidden="true"
        />
        <span className="datasetsCardGroupTitle" title={label}>
          {label}
        </span>
        {here > 0 && (
          <span className="datasetsCardGroupHere">
            <span className="datasetsCardMapClickSwatch" aria-hidden="true" />
            {t("datasetsCardGridGroupHere", { count: here })}
          </span>
        )}
        <span className="datasetsCardGroupCount">{count}</span>
      </button>
    </div>
  );
}
