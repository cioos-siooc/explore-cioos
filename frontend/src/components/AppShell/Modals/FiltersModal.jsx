import * as React from "react";
import { ChevronLeft, Filter } from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";

import Modal from "../../ui/Modal.jsx";
import FiltersPanel from "../Panels/FiltersPanel.jsx";
import useMediaQuery, {
  MOBILE_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import useActiveFilters from "../../../state/useActiveFilters.js";
import { useUI } from "../../../state/ui/UIProvider.jsx";
import "./styles.css";

// The filter-management modal, launched from the Filters button beside the
// sidebar. Hosts the master/detail FiltersPanel; filters apply to the map
// live, so closing is just dismissal — there is no confirm step.
export default function FiltersModal() {
  const { t } = useTranslation();
  const activeFilterCount = useActiveFilters().length;
  const { showFiltersModal, setShowFiltersModal, openFilter, setOpenFilter } =
    useUI();
  const isMobile = useMediaQuery(MOBILE_QUERY);

  // openFilter is a translation key for most filters but an already-translated
  // label for the two range ones (see FiltersPanel), and i18next returns an
  // unknown key unchanged — so t() is the right call for both shapes.
  const openFilterName = openFilter ? t(openFilter) : "";

  return (
    <Modal
      show={showFiltersModal}
      onHide={() => setShowFiltersModal(false)}
      className="filtersModal"
      data-testid="filters-modal"
      dialogClassName="filtersModalDialog"
      aria-labelledby="filtersModalTitle"
    >
      <Modal.Header closeButton>
        <Modal.Title id="filtersModalTitle">
          <span className="filtersModalTitleIcon" aria-hidden="true">
            <Filter size={20} />
          </span>
          <span className="filtersModalTitleText">
            <span className="filtersModalTitleRow">
              {/* On a phone the open filter covers the list it was chosen from
                  (Panels/styles.css), so this is the way back to it. At wider
                  widths the list is still on screen beside the filter, and the
                  open filter's name is only ever named below, in the subtitle. */}
              {isMobile && openFilterName ? (
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
            </span>
            <span className="filtersModalTitleSubtitle">
              {openFilterName || t("filtersModalSubtitleText")}
            </span>
          </span>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <FiltersPanel />
      </Modal.Body>
    </Modal>
  );
}
