import * as React from "react";
import { useRef } from "react";
import { ChevronLeft, ChevronRight, Filter } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import Modal from "../../ui/Modal.jsx";
import FiltersPanel from "../Panels/FiltersPanel.jsx";
import TipCard from "../../Controls/Tips/TipCard.jsx";
import { useFilterSearchShortcut } from "../FilterSearch/FilterSearch.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import useActiveFilters from "../../../state/useActiveFilters.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// Filters apply live, so closing is just dismissal.
export default function FiltersModal() {
  const { t } = useTranslation();
  const activeFilterCount = useActiveFilters().length;
  const {
    showFiltersModal,
    setShowFiltersModal,
    openFilter,
    setOpenFilter,
    filterSearchText,
    openFilterSearch,
  } = useUI();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  useFilterSearchShortcut(openFilterSearch);
  // Not focused on a phone opened from the Filters button: the keyboard would
  // cover the list it was opened to browse.
  const searchInputRef = useRef(null);
  const focusSearch = !isMobile || filterSearchText !== null;

  // A translation key for most filters, an already-translated label for the
  // range ones; i18next returns unknown keys unchanged, so t() suits both.
  // Wider screens title the page itself instead (see Filter).
  const openFilterName = isMobile && openFilter ? t(openFilter) : "";

  return (
    <Modal
      show={showFiltersModal}
      onHide={() => setShowFiltersModal(false)}
      className="filtersModal"
      sheet
      data-testid="filters-modal"
      dialogClassName="filtersModalDialog"
      aria-labelledby="filtersModalTitle"
      initialFocusRef={focusSearch ? searchInputRef : undefined}
    >
      <Modal.Header closeButton>
        <Modal.Title id="filtersModalTitle">
          <span className="filtersModalTitleIcon" aria-hidden="true">
            <Filter size={20} />
          </span>
          <span className="filtersModalTitleText">
            <span className="filtersModalTitleRow">
              {/* On a phone the open filter covers the list, so this is the
                  way back. */}
              {openFilterName ? (
                <button
                  type="button"
                  className="filtersModalBack"
                  onClick={() => setOpenFilter(undefined)}
                  title={t("filtersModalBackTitle")}
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                  <span>{t("filtersMenuButton")}</span>
                </button>
              ) : (
                <span className="filtersModalTitleHeading">
                  {t("filtersMenuButton")}
                </span>
              )}
              {activeFilterCount > 0 && (
                <span
                  className="filtersModalTitleCounter"
                  title={t("dockFiltersCountTitle", {
                    count: activeFilterCount,
                  })}
                >
                  {activeFilterCount}
                </span>
              )}
              {openFilterName && (
                <>
                  <ChevronRight
                    className="filtersModalTitleSeparator"
                    size={14}
                    aria-hidden="true"
                  />
                  <span className="filtersModalTitleHeading filtersModalTitleCrumb">
                    {openFilterName}
                  </span>
                </>
              )}
            </span>
            {!openFilterName && (
              <span className="filtersModalTitleSubtitle">
                {t("filtersModalSubtitleText")}
              </span>
            )}
          </span>
        </Modal.Title>
      </Modal.Header>
      <TipCard inModal="filters" />
      <Modal.Body>
        <FiltersPanel
          searchInputRef={searchInputRef}
          onDone={() => setShowFiltersModal(false)}
        />
      </Modal.Body>
    </Modal>
  );
}
