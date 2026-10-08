import React, { useEffect, useMemo, useRef } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import HarvestLayout from "./HarvestLayout.jsx";
import { HARVEST_DOCS, renderHarvestDoc } from "./harvestDocs.js";

// Mermaid is ~1 MB; only this page needs it, and only once a diagram renders.
async function renderDiagrams(container) {
  const blocks = [...container.querySelectorAll("pre > code.language-mermaid")];
  if (!blocks.length) return;
  const nodes = blocks.map((code) => {
    const node = document.createElement("div");
    node.className = "mermaid";
    node.textContent = code.textContent;
    code.parentElement.replaceWith(node);
    return node;
  });
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
  });
  await mermaid.run({ nodes });
}

export default function HarvestDocs() {
  const { t } = useTranslation();
  const { doc } = useParams();
  const { hash, search } = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef(null);

  const markdown = HARVEST_DOCS[doc];
  const html = useMemo(
    () => markdown && renderHarvestDoc(markdown),
    [markdown],
  );

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;
    renderDiagrams(container).catch((e) =>
      console.warn("Diagram render failed", e),
    );
  }, [html]);

  useEffect(() => {
    const target =
      hash && document.getElementById(decodeURIComponent(hash.slice(1)));
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [html, hash]);

  // Cross-doc links are plain anchors in rendered HTML; route them in-app so
  // the language param and SPA state survive.
  function onContentClick(event) {
    const link = event.target.closest("a[data-route]");
    if (
      !link ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    const [path, anchor = ""] = link.dataset.route.split("#");
    navigate(`${path}${search}${anchor && `#${anchor}`}`);
  }

  const breadcrumbs = (
    <Link to="/harvest" className="harvest-link">
      {t("harvest.title")}
    </Link>
  );

  return (
    <HarvestLayout breadcrumbs={breadcrumbs}>
      <nav className="harvest-doc-tabs" aria-label={t("harvest.docs.title")}>
        {Object.keys(HARVEST_DOCS).map((name) => (
          <NavLink
            key={name}
            to={`/harvest/docs/${name}${search}`}
            className="harvest-doc-tab"
          >
            {t(`harvest.docs.${name}`)}
          </NavLink>
        ))}
      </nav>
      {html ? (
        <article
          ref={contentRef}
          className="harvest-doc"
          onClick={onContentClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="harvest-muted">{t("harvest.docs.notFound")}</p>
      )}
    </HarvestLayout>
  );
}
