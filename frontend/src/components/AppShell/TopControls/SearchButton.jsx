import * as React from "react";
import { Search, X } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { DropdownButton } from "../../ui/Dropdown.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

// Fourth segment of the top bar's Datasets/Filters pill: a quick way into the
// same free-text search the datasets list and the Filters modal's Text Search
// row read and write (datasetTitleSearchText, in SelectionProvider) — no
// separate state of its own. Icon-only like the spatial filter button beside
// it; the popover it opens is a fresh mount each time (DropdownButton only
// renders its children while open), so autoFocus lands reliably every time
// without extra wiring.
export default function SearchButton() {
  const { t } = useTranslation();
  const { datasetTitleSearchText, setDatasetTitleSearchText } = useSelection();
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <DropdownButton
      data-testid="topbar-search"
      onOpenChange={setMenuOpen}
      toggleClassName={classNames("topBarButton topBarSearchToggle", {
        active: menuOpen,
        applied: !menuOpen && Boolean(datasetTitleSearchText),
      })}
      menuClassName="topBarSearchMenu"
      tooltip={t("textSearchFilterName")}
      title={<Search size={18} aria-hidden="true" />}
      // The button sits left-of-centre in the pill (Datasets | Search |
      // Bounding box | Filters), but the popover is nearly as wide as the
      // brand card above it — centering on the button itself would leave it
      // visibly off-centre under that card. The whole top bar is centred on
      // the viewport's own midline (see TopControls/styles.css), so anchoring
      // there instead lines the popover up with the card regardless of where
      // in the pill the button sits.
      align="viewport-center"
    >
      <div className="topBarSearchPopover">
        <Search size={16} aria-hidden="true" />
        <input
          autoFocus
          type="text"
          className="topBarSearchInput"
          value={datasetTitleSearchText}
          onChange={(e) => setDatasetTitleSearchText(e.target.value)}
          placeholder={t("textSearchFilterPlaceholder")}
        />
        {datasetTitleSearchText && (
          <button
            type="button"
            className="topBarSearchClear"
            onClick={() => setDatasetTitleSearchText("")}
            title={t("filterClearSearchTitle")}
            aria-label={t("filterClearSearchTitle")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </DropdownButton>
  );
}
