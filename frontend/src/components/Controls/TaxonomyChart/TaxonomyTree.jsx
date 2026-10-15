import React, { useState } from "react";
import { useTranslation } from "react-i18next";

const INITIAL_OPEN_DEPTH = 1;

function interiorIds(node, depth, maxDepth, ids = new Set()) {
  if (node.children.length && depth < maxDepth) {
    ids.add(node.id);
    node.children.forEach((child) =>
      interiorIds(child, depth + 1, maxDepth, ids),
    );
  }
  return ids;
}

// GBIF's dataset-metrics tree: nested lists with CSS-drawn connector lines,
// each taxon a tile of name and record count; a name opens or closes its
// branch.
export default function TaxonomyTree({ tree }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "fr" ? "fr-CA" : "en-CA";
  const [expanded, setExpanded] = useState(() =>
    interiorIds(tree, 0, INITIAL_OPEN_DEPTH + 1),
  );

  function toggle(id) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderNode(node) {
    const isOpen = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    return (
      <li key={node.id} className="taxonomyTreeItem">
        <span className="taxonomyTreeTile">
          {hasChildren ? (
            <button
              type="button"
              className="taxonomyTreeName"
              aria-expanded={isOpen}
              title={t(`taxonRank_${node.rank}`)}
              onClick={() => toggle(node.id)}
            >
              {node.name}
            </button>
          ) : (
            <span
              className="taxonomyTreeName"
              title={t(`taxonRank_${node.rank}`)}
            >
              {node.name}
            </span>
          )}
          <span className="taxonomyTreeCount">
            {node.total.toLocaleString(locale)}
          </span>
        </span>
        {hasChildren && isOpen && (
          <ul className="taxonomyTreeLines">{node.children.map(renderNode)}</ul>
        )}
      </li>
    );
  }

  return (
    <div className="taxonomyTree">
      <div className="taxonomyTreeActions">
        <button
          type="button"
          className="recordShowAll"
          onClick={() => setExpanded(interiorIds(tree, 0, Infinity))}
        >
          {t("taxonomyExpandAllText")}
        </button>
        <button
          type="button"
          className="recordShowAll"
          onClick={() => setExpanded(new Set([tree.id]))}
        >
          {t("taxonomyCollapseAllText")}
        </button>
      </div>
      <ul className="taxonomyTreeRoot">
        <li className="taxonomyTreeItem">
          <span className="taxonomyTreeTile">
            <span className="taxonomyTreeName">{t("taxonomyAllText")}</span>
            <span className="taxonomyTreeCount">
              {tree.total.toLocaleString(locale)}
            </span>
          </span>
          <ul className="taxonomyTreeLines">{tree.children.map(renderNode)}</ul>
        </li>
      </ul>
    </div>
  );
}
