import * as React from "react";
import { useState } from "react";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  DashSquare,
  Square,
  XSquare,
} from "react-bootstrap-icons";
import { useTranslation } from "react-i18next";
import {
  capitalizeFirstLetter,
  toggleOptionExcluded,
  toggleOptionIncluded,
} from "../../../../utilities";
import { FilterOption } from "../MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

// Combined data-source filter: ERDDAP servers as a flat list, plus a single
// expandable OBIS group whose parent checkbox selects/deselects every OBIS
// node. Nodes remain individually selectable inside the group.
export default function SourceFilter({
  erddapServersSelected,
  setErddapServersSelected,
  obisNodesSelected,
  setObisNodesSelected,
  searchTerms,
}) {
  const { t, i18n } = useTranslation();
  const [obisExpanded, setObisExpanded] = useState(false);

  const search = (searchTerms || "").toString().toLowerCase();
  const obisGroupMatchesSearch = "obis".includes(search);

  const serversShown = erddapServersSelected
    .filter((server) => !search || server.title.toLowerCase().includes(search))
    .sort((a, b) => a.title.localeCompare(b.title, i18n.language));

  // When the search matches the group label itself, show every node
  const nodesShown = obisNodesSelected
    .filter(
      (node) =>
        !search ||
        obisGroupMatchesSearch ||
        node.title.toLowerCase().includes(search),
    )
    .sort((a, b) => a.title.localeCompare(b.title, i18n.language));

  const showObisGroup =
    obisNodesSelected.length > 0 && (!search || nodesShown.length > 0);

  // Nothing ticked anywhere constrains nothing, so an empty selection already
  // means every source — see MultiCheckboxFilter. Shown as it is stored: no
  // ticks until the user picks something.
  const isChecked = (option) => option.isSelected;

  const allNodesSelected =
    obisNodesSelected.length > 0 && obisNodesSelected.every(isChecked);
  const allNodesExcluded =
    obisNodesSelected.length > 0 &&
    obisNodesSelected.every((node) => node.isExcluded);
  const someNodesSet = obisNodesSelected.some(
    (node) => node.isSelected || node.isExcluded,
  );

  function updateServer(pk, toggle) {
    setErddapServersSelected(
      erddapServersSelected.map((server) =>
        server.pk === pk ? toggle(server) : server,
      ),
    );
  }

  function updateNode(pk, toggle) {
    setObisNodesSelected(
      obisNodesSelected.map((node) => (node.pk === pk ? toggle(node) : node)),
    );
  }

  // The group sets every node at once; a mixed group goes to all-included (or
  // all-excluded) first, so the first click always means "all of OBIS".
  function setAllNodes({ isSelected, isExcluded }) {
    setObisNodesSelected(
      obisNodesSelected.map((node) => ({ ...node, isSelected, isExcluded })),
    );
  }

  const obisChildrenVisible = obisExpanded || (search && nodesShown.length > 0);

  if (serversShown.length === 0 && !showObisGroup) {
    return (
      <div className="multiCheckboxFilter sourceFilter">
        <div>{t("multiCheckboxFilterNoFilterWarning")}</div>
      </div>
    );
  }

  return (
    <div className="multiCheckboxFilter sourceFilter">
      {serversShown.map((server) => (
        <FilterOption
          key={server.pk}
          label={server.title}
          isSelected={server.isSelected}
          isExcluded={server.isExcluded}
          onInclude={() => updateServer(server.pk, toggleOptionIncluded)}
          onExclude={() => updateServer(server.pk, toggleOptionExcluded)}
          title={server.title}
        >
          <span className="optionName">
            {capitalizeFirstLetter(server.title)}
          </span>
        </FilterOption>
      ))}
      {showObisGroup && (
        <>
          {/* The chevron sits beside the group's row, not in it: inside, it
              would be a button nested in the checkbox. */}
          <div className="obisGroupRow">
            <FilterOption
              className="obisGroupButton"
              label="OBIS"
              isSelected={allNodesSelected}
              isExcluded={allNodesExcluded}
              onInclude={() =>
                setAllNodes({
                  isSelected: !allNodesSelected,
                  isExcluded: false,
                })
              }
              onExclude={() =>
                setAllNodes({
                  isSelected: false,
                  isExcluded: !allNodesExcluded,
                })
              }
              title={t("sourceFilterObisGroupTooltip")}
              icon={
                allNodesSelected ? (
                  <CheckSquare />
                ) : allNodesExcluded ? (
                  <XSquare />
                ) : someNodesSet ? (
                  <DashSquare />
                ) : (
                  <Square />
                )
              }
            >
              <span className="optionName">OBIS</span>
            </FilterOption>
            <button
              type="button"
              className="obisGroupChevron"
              aria-expanded={obisChildrenVisible}
              aria-label={t("sourceFilterObisExpandLabel")}
              onClick={() => setObisExpanded(!obisExpanded)}
            >
              {obisChildrenVisible ? <ChevronDown /> : <ChevronRight />}
            </button>
          </div>
          {obisChildrenVisible && (
            <div className="obisGroupChildren">
              {nodesShown.map((node) => (
                <FilterOption
                  key={node.pk}
                  label={node.title}
                  isSelected={node.isSelected}
                  isExcluded={node.isExcluded}
                  onInclude={() => updateNode(node.pk, toggleOptionIncluded)}
                  onExclude={() => updateNode(node.pk, toggleOptionExcluded)}
                  title={node.title}
                >
                  <span className="optionName">{node.title}</span>
                </FilterOption>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
