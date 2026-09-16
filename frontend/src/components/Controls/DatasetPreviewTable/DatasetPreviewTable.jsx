import React, { useState } from "react";

import "./styles.css";
import DataTable from "react-data-table-component";
import { useTranslation } from "react-i18next";
import TableFilter, { filterRows } from "../../ui/TableFilter.jsx";
import { splitLines } from "../../../utilities";

export default function DatasetPreviewTable({ datasetPreview, data }) {
  // Hooks run before the empty-state guard: `datasetPreview` arrives
  // asynchronously, so returning early above them would change the hook order
  // between renders.
  const { t } = useTranslation();
  const [filterText, setFilterText] = useState("");

  const { columnNames, columnUnits } = datasetPreview?.table || {
    rows: [],
    columnNames: [],
  };

  const columns = columnNames.map((colName, i) => ({
    name: splitLines(
      colName + " " + (columnUnits[i] ? `(${columnUnits[i]})` : ""),
    ),
    selector: (row) => row[colName],
    reorder: true,
    wrap: true,
    sortable: true,
  }));

  const filteredData = filterRows(data, filterText);

  if (!datasetPreview) return <div />;

  return (
    <>
      <TableFilter
        value={filterText}
        onChange={setFilterText}
        placeholder={t("datasetInspectorFilterText")}
      />
      <DataTable
        striped
        columns={columns}
        data={filteredData}
        pagination={filteredData?.length > 10}
        paginationPerPage={10}
        paginationRowsPerPageOptions={[10, 100, 150, 200, 250]}
        paginationComponentOptions={{
          rowsPerPageText: t("tableComponentRowsPerPage"),
          rangeSeparatorText: t("tableComponentOf"),
          selectAllRowsItem: false,
        }}
        dense
      />
    </>
  );
}
