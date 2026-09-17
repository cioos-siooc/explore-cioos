import * as React from "react";
import { useEffect, useState } from "react";
import {
  BoundingBox,
  Check2,
  ChevronDown,
  Clipboard,
  Pentagon,
  Search,
  X,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import classNames from "classnames";

import { DropdownButton, Dropdown } from "../../ui/Dropdown.jsx";
import {
  polygonIsRectangle,
  polygonToWkt,
  useDebouncedSearchInput,
} from "../../../utilities.jsx";
import { useMapState } from "../../../state/map/MapStateProvider.jsx";
import { useSelection } from "../../../state/selection/SelectionProvider.jsx";

// The caret welded onto the Filters segment: the two filters that are worth
// reaching without opening the Filters modal at all, because both of them act
// on the map rather than on a list of options — the free-text search, and the
// box/polygon draw.
//
// They used to be two full segments of their own in the pill, which left the
// row with no single meaning: three view/control peers interleaved with two
// arbitrary shortcuts into rows of the Filters modal. Neither is a new filter
// here — the search writes the same datasetTitleSearchText the datasets list
// and the modal's Text Search row do, and the draw items send the same
// one-shot requestDraw the modal's Area pane does.
//
// No "arm the last-used tool on open" behaviour, unlike the old dedicated
// draw button: opening this menu is no longer unambiguously the start of a
// draw — it may be to search — so a draw starts only on an explicit click,
// the same rule the Filters modal's Area pane already follows.
export default function QuickFiltersButton() {
  const { t } = useTranslation();
  const { requestDraw } = useMapState();
  const { polygon, datasetTitleSearchText, setDatasetTitleSearchText } =
    useSelection();
  const [menuOpen, setMenuOpen] = useState(false);

  // The search behind it reaches the map, the datasets list and the counters,
  // so it is published on a pause rather than per keystroke. The hook lives
  // here rather than in the menu below, which only exists while the menu is
  // open — inside it, closing the menu would drop whatever was still in
  // flight.
  const [searchText, setSearchText] = useDebouncedSearchInput(
    datasetTitleSearchText,
    setDatasetTitleSearchText,
  );

  // Briefly swaps the copy button's icon to a checkmark after a successful
  // copy, then reverts — a timeout in an effect (not the click handler) so
  // it's cleared if the menu closes (or the selection changes) mid-countdown.
  const [wktCopied, setWktCopied] = useState(false);
  useEffect(() => {
    if (!wktCopied) return;
    const timer = setTimeout(() => setWktCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [wktCopied]);

  const hasSelection = Boolean(polygon);
  // Which of the two tools produced the shape currently on the map, so the
  // menu says which one is in effect. Read off the shape itself rather than
  // remembered, so one restored from a share link is named too.
  const activeMode = hasSelection
    ? polygonIsRectangle(polygon)
      ? "box"
      : "polygon"
    : undefined;

  return (
    <DropdownButton
      data-testid="topbar-quick-filters"
      onOpenChange={setMenuOpen}
      toggleClassName={classNames(
        "topBarButton topBarIconButton topBarQuickFiltersToggle",
        {
          // Solid while the menu itself is up; once it's closed, either of the
          // two filters underneath still staying set keeps the caret in the
          // lighter "applied" wash, so the pill goes on signalling that
          // something is set under here without competing with whatever UI is
          // actually open. What is set is named in full by the chips below.
          active: menuOpen,
          applied:
            !menuOpen && (hasSelection || Boolean(datasetTitleSearchText)),
        },
      )}
      menuClassName="topBarQuickFiltersMenu"
      tooltip={t("topBarQuickFiltersLabel")}
      title={<ChevronDown size={16} aria-hidden="true" />}
      // The caret is the right-most thing in the pill and the menu is much
      // wider than it, so both of the other alignments would hang the menu
      // out past the brand card it reads as belonging to.
      align="end"
    >
      {/* Not a Dropdown.Item: those close the menu on click, which is right
          for the draw rows below but would shut the menu on the first
          keystroke here. Clicks inside it are safe — DropdownButton's
          click-outside check treats the whole menu as inside. */}
      <div className="topBarSearchRow">
        <Search size={16} aria-hidden="true" />
        <input
          type="text"
          className="topBarSearchInput"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={t("textSearchFilterPlaceholder")}
          aria-label={t("textSearchFilterName")}
        />
        {searchText && (
          <button
            type="button"
            className="topBarSearchClear"
            onClick={() => setSearchText("")}
            title={t("filterClearSearchTitle")}
            aria-label={t("filterClearSearchTitle")}
          >
            <X size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      <Dropdown.Item
        onClick={() => requestDraw("box")}
        active={activeMode === "box"}
      >
        <BoundingBox size={16} aria-hidden="true" />
        {t("drawBoundingBoxOption")}
      </Dropdown.Item>
      <Dropdown.Item
        onClick={() => requestDraw("polygon")}
        active={activeMode === "polygon"}
      >
        <Pentagon size={16} aria-hidden="true" />
        {t("drawPolygonOption")}
      </Dropdown.Item>
      {hasSelection && (
        <Dropdown.Item onClick={() => requestDraw("clear")}>
          <X size={16} aria-hidden="true" />
          {t("drawClearOption")}
        </Dropdown.Item>
      )}
      {hasSelection && (
        <div className="spatialFilterWktSection">
          <button
            type="button"
            className="dropdown-item"
            onClick={() => {
              navigator.clipboard.writeText(polygonToWkt(polygon));
              setWktCopied(true);
            }}
          >
            {wktCopied ? (
              <Check2 size={16} aria-hidden="true" />
            ) : (
              <Clipboard size={16} aria-hidden="true" />
            )}
            {t(wktCopied ? "copiedSelectionWktTitle" : "copySelectionWktTitle")}
          </button>
        </div>
      )}
    </DropdownButton>
  );
}
