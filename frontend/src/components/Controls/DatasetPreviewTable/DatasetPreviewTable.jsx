import React, { useMemo, useState } from "react";

import "./styles.css";
import DataTable from "react-data-table-component";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "react-bootstrap-icons";
import TableFilter, { filterRows } from "../../ui/TableFilter.jsx";
import useElementSize from "../../ui/useElementSize.js";
import useMediaQuery, {
  PREVIEW_COMPACT_QUERY,
} from "../../../state/ui/useMediaQuery.js";
import { formatCell, tableLayoutFor } from "./previewTable.js";

const PER_PAGE = 50;
// The pager's own row, which sits under the scroller.
const PAGINATION_PX = 56;
const MIN_SCROLL_PX = 200;
const ASIDE_TITLE_ID = "previewTableAsideTitle";

// The library's stock look, redrawn in the app's ink, hairlines and washes.
const STYLES = {
  headRow: {
    style: {
      minHeight: "48px",
      borderBottomColor: "var(--cioos-hairline)",
    },
  },
  headCells: {
    style: {
      alignItems: "flex-end",
      paddingBottom: "6px",
      color: "var(--cioos-ink)",
      fontSize: "var(--cioos-font-size-xs)",
      fontWeight: 600,
    },
  },
  rows: {
    style: {
      minHeight: "32px",
      color: "var(--cioos-ink-80)",
      fontSize: "var(--cioos-font-size-sm)",
      borderBottomColor: "var(--cioos-hairline)",
    },
    stripedStyle: {
      backgroundColor: "var(--cioos-surface-2)",
      color: "var(--cioos-ink-80)",
    },
  },
  cells: {
    style: { fontVariantNumeric: "tabular-nums" },
  },
  pagination: {
    style: {
      color: "var(--cioos-ink-80)",
      fontSize: "var(--cioos-font-size-sm)",
      borderTopColor: "var(--cioos-hairline)",
    },
  },
};

export default function DatasetPreviewTable({
  datasetPreview,
  data,
  variables,
  availableHeight,
}) {
  // Hooks before the empty-state guard, or the hook order changes between renders.
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");
  const [headerRef, headerSize] = useElementSize();
  const compact = useMediaQuery(PREVIEW_COMPACT_QUERY);

  const table = datasetPreview?.table;
  const layout = useMemo(
    () =>
      table
        ? tableLayoutFor(table, data, variables)
        : { constants: [], columns: [] },
    [table, data, variables],
  );

  const columns = useMemo(
    () =>
      layout.columns.map(({ name, unit, width }) => ({
        id: name,
        name: (
          <span className="previewTableHead">
            <span>{name}</span>
            {unit && <span className="previewTableUnit">({unit})</span>}
          </span>
        ),
        selector: (row) => row[name],
        cell: (row) => (
          <span className="previewTableCell" title={String(row[name] ?? "")}>
            {formatCell(row[name])}
          </span>
        ),
        minWidth: `${width}px`,
        reorder: true,
        sortable: true,
      })),
    [layout],
  );

  const filteredData = filterRows(data, filterText);

  if (!datasetPreview) return <div />;

  const paginated = filteredData?.length > PER_PAGE;
  // The rows scroll under a fixed header, so the table fills the modal rather
  // than ending a page early above an empty half.
  const scrollHeight = availableHeight
    ? Math.max(
        availableHeight -
          headerSize.height -
          (paginated ? PAGINATION_PX : 0) -
          8,
        MIN_SCROLL_PX,
      )
    : null;

  const hasConstants = layout.constants.length > 0;
  const constantsList = hasConstants && (
    <table className="previewTableConstantsList">
      <thead className="sr-only">
        <tr>
          <th scope="col">{t("datasetPreviewTableConstantsName")}</th>
          <th scope="col">{t("datasetPreviewTableConstantsValue")}</th>
        </tr>
      </thead>
      <tbody>
        {layout.constants.map(({ name, unit, value }) => (
          <tr key={name}>
            <th scope="row">
              {name}
              {unit && <span className="previewTableUnit"> ({unit})</span>}
            </th>
            <td className={value ? undefined : "isEmpty"}>
              {value || t("datasetPreviewPlotNoDataMarker")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  const constantsCaption = (
    <>
      <span className="previewTableConstantsLabel">
        {t("datasetPreviewTableConstants")}
      </span>
      <span className="previewTableConstantsCount">
        {layout.constants.length}
      </span>
    </>
  );

  return (
    <div className="previewTableLayout">
      {/* Beside the grid, where the plot view keeps its settings; folded above
          it once the modal is too narrow to give up the width. */}
      {hasConstants && !compact && (
        <aside className="previewTableAside" aria-labelledby={ASIDE_TITLE_ID}>
          <h3 className="previewTableAsideTitle" id={ASIDE_TITLE_ID}>
            {constantsCaption}
          </h3>
          {constantsList}
        </aside>
      )}
      <div className="previewTableMain">
        <div className="previewTableHeader" ref={headerRef}>
          <div className="datasetPreviewFilter">
            <TableFilter
              value={filterText}
              onChange={setFilterText}
              placeholder={t("datasetInspectorFilterText")}
            />
          </div>
          {hasConstants && compact && (
            <details className="previewTableConstants">
              <summary>
                <ChevronRight
                  className="previewTableConstantsChevron"
                  size={12}
                  aria-hidden="true"
                />
                {constantsCaption}
              </summary>
              {constantsList}
            </details>
          )}
        </div>
        <DataTable
          striped
          columns={columns}
          data={filteredData}
          customStyles={STYLES}
          fixedHeader={Boolean(scrollHeight)}
          fixedHeaderScrollHeight={
            scrollHeight ? `${scrollHeight}px` : undefined
          }
          pagination={paginated}
          paginationPerPage={PER_PAGE}
          paginationRowsPerPageOptions={[25, PER_PAGE, 100, 250]}
          paginationComponentOptions={{
            rowsPerPageText: t("tableComponentRowsPerPage"),
            rangeSeparatorText: t("tableComponentOf"),
            selectAllRowsItem: false,
          }}
          dense
        />
      </div>
    </div>
  );
}
