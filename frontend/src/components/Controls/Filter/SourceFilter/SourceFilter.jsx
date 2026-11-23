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
import { featuredObisNodes } from "../../../config.js";
import { FilterOption } from "../MultiCheckboxFilter/OptionState.jsx";
import Button from "../../../ui/Button.jsx";
import { Disclosure, DisclosurePanel } from "../../../ui/Disclosure.jsx";
import "./styles.css";

export default function SourceFilter({
  erddapServersSelected,
  setErddapServersSelected,
  obisNodesSelected,
  setObisNodesSelected,
  searchTerms,
}) {
  const { t, i18n } = useTranslation();
  const [showAllNodes, setShowAllNodes] = useState(false);

  const search = (searchTerms || "").toString().toLowerCase();
  const byTitle = (a, b) => a.title.localeCompare(b.title, i18n.language);
  const matching = (options, groupLabel) =>
    options
      .filter(
        (option) =>
          !search ||
          groupLabel.toLowerCase().includes(search) ||
          option.title.toLowerCase().includes(search),
      )
      .sort(byTitle);

  const serversShown = matching(erddapServersSelected, "ERDDAP");
  const nodesMatching = matching(obisNodesSelected, "OBIS");
  // A node the user has set stays listed, so its state is never out of sight.
  const nodesShown =
    search || showAllNodes
      ? nodesMatching
      : nodesMatching.filter(
          (node) =>
            featuredObisNodes.includes(node.title) ||
            node.isSelected ||
            node.isExcluded,
        );
  const moreNodesCount = nodesMatching.length - nodesShown.length;

  if (serversShown.length === 0 && nodesMatching.length === 0) {
    return (
      <div className="multiCheckboxFilter sourceFilter">
        <div>{t("multiCheckboxFilterNoFilterWarning")}</div>
      </div>
    );
  }

  return (
    <div className="multiCheckboxFilter sourceFilter">
      {serversShown.length > 0 && (
        <SourceGroup
          label="ERDDAP"
          options={erddapServersSelected}
          setOptions={setErddapServersSelected}
          shown={serversShown}
          forceExpanded={Boolean(search)}
        />
      )}
      {nodesMatching.length > 0 && (
        <SourceGroup
          label="OBIS"
          options={obisNodesSelected}
          setOptions={setObisNodesSelected}
          shown={nodesShown}
          forceExpanded={Boolean(search)}
        >
          {(moreNodesCount > 0 || showAllNodes) && !search && (
            <Button
              className="sourceGroupMore"
              onPress={() => setShowAllNodes(!showAllNodes)}
            >
              {showAllNodes
                ? t("sourceFilterShowFewer")
                : t("sourceFilterShowMore", { count: moreNodesCount })}
            </Button>
          )}
        </SourceGroup>
      )}
    </div>
  );
}

function SourceGroup({
  label,
  options,
  setOptions,
  shown,
  forceExpanded,
  children,
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const allSelected = options.length > 0 && options.every((o) => o.isSelected);
  const allExcluded = options.length > 0 && options.every((o) => o.isExcluded);
  const someSet = options.some((o) => o.isSelected || o.isExcluded);

  function update(pk, toggle) {
    setOptions(options.map((o) => (o.pk === pk ? toggle(o) : o)));
  }

  function setAll({ isSelected, isExcluded }) {
    setOptions(options.map((o) => ({ ...o, isSelected, isExcluded })));
  }

  const childrenVisible = expanded || forceExpanded;

  return (
    <Disclosure
      className="sourceGroup"
      isExpanded={childrenVisible}
      onExpandedChange={setExpanded}
    >
      {/* The chevron sits beside the group's row, not in it: inside, it would
          be a button nested in the checkbox. */}
      <div className="sourceGroupRow">
        <FilterOption
          className="sourceGroupButton"
          label={label}
          isSelected={allSelected}
          isExcluded={allExcluded}
          isIndeterminate={!allSelected && someSet && !allExcluded}
          onInclude={() =>
            setAll({ isSelected: !allSelected, isExcluded: false })
          }
          onExclude={() =>
            setAll({ isSelected: false, isExcluded: !allExcluded })
          }
          title={t("sourceFilterGroupTooltip", { group: label })}
          icon={
            allSelected ? (
              <CheckSquare />
            ) : allExcluded ? (
              <XSquare />
            ) : someSet ? (
              <DashSquare />
            ) : (
              <Square />
            )
          }
        >
          <span className="optionName">{label}</span>
        </FilterOption>
        <Button
          slot="trigger"
          className="sourceGroupChevron"
          aria-label={t("sourceFilterGroupExpandLabel", { group: label })}
        >
          {childrenVisible ? <ChevronDown /> : <ChevronRight />}
        </Button>
      </div>
      <DisclosurePanel className="sourceGroupChildren">
        {shown.map((option) => (
          <FilterOption
            key={option.pk}
            label={option.title}
            isSelected={option.isSelected}
            isExcluded={option.isExcluded}
            onInclude={() => update(option.pk, toggleOptionIncluded)}
            onExclude={() => update(option.pk, toggleOptionExcluded)}
            title={option.title}
          >
            <span className="optionName">
              {capitalizeFirstLetter(option.title)}
            </span>
          </FilterOption>
        ))}
        {children}
      </DisclosurePanel>
    </Disclosure>
  );
}
