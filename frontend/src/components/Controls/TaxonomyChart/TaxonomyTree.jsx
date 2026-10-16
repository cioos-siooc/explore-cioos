import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { inkOn, phylumColors } from "./taxonomy.js";

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

export default function TaxonomyTree({ tree, actionsEl }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "fr" ? "fr-CA" : "en-CA";
  const colors = useMemo(() => phylumColors(tree), [tree]);
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

  // A phylum's colour carries down its whole branch, as in the sunburst.
  function renderNode(node, inheritedColor) {
    const isOpen = expanded.has(node.id);
    const hasChildren = node.children.length > 0;
    const color = colors.get(node.id) ?? inheritedColor;
    return (
      <li key={node.id} className="taxonomyTreeItem">
        <span
          className="taxonomyTreeTile"
          data-ink={color && inkOn(color)}
          style={color && { "--taxon-color": color }}
        >
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
          <ul className="taxonomyTreeLines">
            {node.children.map((child) => renderNode(child, color))}
          </ul>
        )}
      </li>
    );
  }

  const actions = (
    <>
      <button
        type="button"
        className="recordShowAll"
        onClick={() => setExpanded(interiorIds(tree, 0, Infinity))}
      >
        {t("taxonomyShowAllText")}
      </button>
      <button
        type="button"
        className="recordShowAll"
        onClick={() => setExpanded(new Set([tree.id]))}
      >
        {t("taxonomyCollapseAllText")}
      </button>
    </>
  );

  return (
    <div className="taxonomyTree">
      {actionsEl ? createPortal(actions, actionsEl) : actions}
      <ul className="taxonomyTreeRoot">
        <li className="taxonomyTreeItem">
          <span className="taxonomyTreeTile">
            <span className="taxonomyTreeName">{t("taxonomyAllText")}</span>
            <span className="taxonomyTreeCount">
              {tree.total.toLocaleString(locale)}
            </span>
          </span>
          <ul className="taxonomyTreeLines">
            {tree.children.map((child) => renderNode(child))}
          </ul>
        </li>
      </ul>
    </div>
  );
}
