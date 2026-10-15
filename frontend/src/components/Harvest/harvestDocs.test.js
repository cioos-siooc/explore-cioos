import { describe, it, expect } from "vitest";
import { HARVEST_DOCS, renderHarvestDoc, slugify } from "./harvestDocs.js";

describe("renderHarvestDoc", () => {
  it("turns sibling-doc links into in-app routes", () => {
    const html = renderHarvestDoc("[Loading](workflow.md#loading)");
    expect(html).toContain(
      'href="/harvest/docs/workflow#loading" data-route="/harvest/docs/workflow#loading"',
    );
  });

  it("opens external links in a new tab and leaves in-page anchors alone", () => {
    const html = renderHarvestDoc("[OBIS](https://obis.org) [up](#top)");
    expect(html).toContain(
      '<a href="https://obis.org" target="_blank" rel="noopener noreferrer">OBIS</a>',
    );
    expect(html).toContain('<a href="#top">up</a>');
  });

  it("drops the GitHub nav block, which the page replaces with tabs", () => {
    const html = renderHarvestDoc(HARVEST_DOCS.erddap);
    expect(html).not.toContain("Harvest docs:");
    expect(html).not.toContain("<blockquote>");
  });

  it("gives headings GitHub-style ids", () => {
    expect(renderHarvestDoc("## Reason codes")).toContain(
      '<h2 id="reason-codes">',
    );
    expect(slugify("Moving platforms: <code>Trajectory</code>")).toBe(
      "moving-platforms-trajectory",
    );
  });
});

describe("HARVEST_DOCS", () => {
  it("bundles the three docs from docs/harvesting", () => {
    expect(HARVEST_DOCS.workflow).toMatch(/^# Harvest workflow/);
    expect(HARVEST_DOCS.erddap).toMatch(/^# ERDDAP harvest strategy/);
    expect(HARVEST_DOCS.obis).toMatch(/^# OBIS harvest strategy/);
  });

  it("every cross-doc anchor points at a heading that exists", () => {
    for (const markdown of Object.values(HARVEST_DOCS)) {
      for (const [, doc, anchor] of markdown.matchAll(
        /\]\((workflow|erddap|obis)\.md#([\w-]+)\)/g,
      )) {
        expect(renderHarvestDoc(HARVEST_DOCS[doc])).toContain(`id="${anchor}"`);
      }
    }
  });
});
