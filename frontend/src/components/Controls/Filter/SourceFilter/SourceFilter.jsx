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
import { buildPortals } from "../../../../state/portals.js";
import { featuredObisNodes } from "../../../config.js";
import { FilterOption } from "../MultiCheckboxFilter/OptionState.jsx";
import "./styles.css";

export default function SourceFilter({ searchTerms, ...lists }) {
  const { t, i18n } = useTranslation();
  const [showAllNodes, setShowAllNodes] = useState(false);

  const search = (searchTerms || "").toString().toLowerCase();
  const matches = (text) => text.toLowerCase().includes(search);
  const portals = buildPortals(lists, i18n.language)
    .map((portal) => ({
      ...portal,
      shown: portal.leaves
        .filter(
          (leaf) => !search || matches(portal.label) || matches(leaf.label),
        )
        .sort((a, b) =>
          portal.isObis ? a.label.localeCompare(b.label, i18n.language) : 0,
        ),
    }))
    .filter((portal) => portal.shown.length > 0);

  if (portals.length === 0) {
    return (
      <div className="multiCheckboxFilter sourceFilter">
        <div>{t("multiCheckboxFilterNoFilterWarning")}</div>
      </div>
    );
  }

  return (
    <div className="multiCheckboxFilter sourceFilter">
      {portals.map((portal) => {
        if (!portal.isObis) {
          return (
            <SourceGroup
              key={portal.key}
              portal={portal}
              shown={portal.shown}
              forceExpanded={Boolean(search)}
            />
          );
        }
        // A node the user has set stays listed, so its state is never out of
        // sight.
        const nodesShown =
          search || showAllNodes
            ? portal.shown
            : portal.shown.filter(
                (leaf) =>
                  featuredObisNodes.includes(leaf.label) ||
                  leaf.option.isSelected ||
                  leaf.option.isExcluded,
              );
        const moreNodesCount = portal.shown.length - nodesShown.length;
        return (
          <SourceGroup
            key={portal.key}
            portal={portal}
            shown={nodesShown}
            forceExpanded={Boolean(search)}
          >
            {(moreNodesCount > 0 || showAllNodes) && !search && (
              <button
                type="button"
                className="sourceGroupMore"
                onClick={() => setShowAllNodes(!showAllNodes)}
              >
                {showAllNodes
                  ? t("sourceFilterShowFewer")
                  : t("sourceFilterShowMore", { count: moreNodesCount })}
              </button>
            )}
          </SourceGroup>
        );
      })}
    </div>
  );
}

function SourceGroup({ portal, shown, forceExpanded, children }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const { label, state } = portal;

  const childrenVisible = expanded || forceExpanded;

  return (
    <>
      {/* The chevron sits beside the group's row, not in it: inside, it would
          be a button nested in the checkbox. */}
      <div className="sourceGroupRow">
        <FilterOption
          className="sourceGroupButton"
          label={label}
          isSelected={state === "include"}
          isExcluded={state === "exclude"}
          onInclude={() => portal.toggle("include")}
          onExclude={() => portal.toggle("exclude")}
          title={t("sourceFilterGroupTooltip", { group: label })}
          icon={
            state === "include" ? (
              <CheckSquare />
            ) : state === "exclude" ? (
              <XSquare />
            ) : portal.someSet ? (
              <DashSquare />
            ) : (
              <Square />
            )
          }
        >
          <span className="optionName">{label}</span>
        </FilterOption>
        <button
          type="button"
          className="sourceGroupChevron"
          aria-expanded={childrenVisible}
          aria-label={t("sourceFilterGroupExpandLabel", { group: label })}
          onClick={() => setExpanded(!childrenVisible)}
        >
          {childrenVisible ? <ChevronDown /> : <ChevronRight />}
        </button>
      </div>
      {childrenVisible && (
        <div className="sourceGroupChildren">
          {shown.map((leaf) => (
            <FilterOption
              key={leaf.id}
              label={leaf.label}
              isSelected={leaf.option.isSelected}
              isExcluded={leaf.option.isExcluded}
              onInclude={() => setLeaf(leaf, toggleOptionIncluded)}
              onExclude={() => setLeaf(leaf, toggleOptionExcluded)}
              title={leaf.option.url ?? leaf.label}
            >
              <span className="optionName">
                {capitalizeFirstLetter(leaf.label)}
              </span>
            </FilterOption>
          ))}
          {children}
        </div>
      )}
    </>
  );
}

function setLeaf(leaf, toggle) {
  leaf.setList((prev) =>
    prev.map((o) => (o.pk === leaf.option.pk ? toggle(o) : o)),
  );
}
