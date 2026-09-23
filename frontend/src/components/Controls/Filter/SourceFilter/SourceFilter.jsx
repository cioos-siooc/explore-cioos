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
import { capitalizeFirstLetter, nextOptionState } from "../../../../utilities";
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

  function toggleServer(pk) {
    setErddapServersSelected(
      erddapServersSelected.map((server) =>
        server.pk === pk ? nextOptionState(server) : server,
      ),
    );
  }

  function toggleNode(pk) {
    setObisNodesSelected(
      obisNodesSelected.map((node) =>
        node.pk === pk ? nextOptionState(node) : node,
      ),
    );
  }

  // The group runs the same cycle over every node at once; a mixed group
  // starts it from the top, so the first click always means "all of OBIS".
  function toggleAllNodes() {
    setObisNodesSelected(
      obisNodesSelected.map((node) => ({
        ...node,
        isSelected: !allNodesSelected && !allNodesExcluded,
        isExcluded: allNodesSelected,
      })),
    );
  }

  const optionClass = (option) =>
    `optionButton ${isChecked(option) ? "selected" : ""} ${
      option.isExcluded ? "excluded" : ""
    }`;
  const optionIcon = (option) =>
    isChecked(option) ? (
      <CheckSquare />
    ) : option.isExcluded ? (
      <XSquare />
    ) : (
      <Square />
    );
  const excludedLabel = (option) =>
    option.isExcluded && (
      <span className="sr-only">{` (${t("filterOptionExcludedLabel")})`}</span>
    );

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
        <div
          key={server.pk}
          className={optionClass(server)}
          title={server.title}
          onClick={() => toggleServer(server.pk)}
        >
          {optionIcon(server)}
          <span className="optionName">
            {capitalizeFirstLetter(server.title)}
          </span>
          {excludedLabel(server)}
        </div>
      ))}
      {showObisGroup && (
        <>
          <div
            className={`optionButton obisGroupButton ${
              allNodesSelected ? "selected" : ""
            } ${allNodesExcluded ? "excluded" : ""}`}
            title={t("sourceFilterObisGroupTooltip")}
            onClick={() => toggleAllNodes()}
          >
            {allNodesSelected ? (
              <CheckSquare />
            ) : allNodesExcluded ? (
              <XSquare />
            ) : someNodesSet ? (
              <DashSquare />
            ) : (
              <Square />
            )}
            <span className="optionName">OBIS</span>
            <span
              className="obisGroupChevron"
              onClick={(e) => {
                e.stopPropagation();
                setObisExpanded(!obisExpanded);
              }}
            >
              {obisChildrenVisible ? <ChevronDown /> : <ChevronRight />}
            </span>
          </div>
          {obisChildrenVisible && (
            <div className="obisGroupChildren">
              {nodesShown.map((node) => (
                <div
                  key={node.pk}
                  className={optionClass(node)}
                  title={node.title}
                  onClick={() => toggleNode(node.pk)}
                >
                  {optionIcon(node)}
                  <span className="optionName">{node.title}</span>
                  {excludedLabel(node)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
