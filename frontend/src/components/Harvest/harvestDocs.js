import { Marked } from "marked";
import workflow from "@harvest-docs/workflow.md?raw";
import erddap from "@harvest-docs/erddap.md?raw";
import obis from "@harvest-docs/obis.md?raw";

export const HARVEST_DOCS = { workflow, erddap, obis };

const DOC_LINK = /^(workflow|erddap|obis)\.md(#[\w-]+)?$/;
const BASE = (process.env.BASE_URL || "/").replace(/\/$/, "");

// GitHub's heading anchor rule, so `#loading`-style links work in both places.
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\w\- ]/g, "")
    .trim()
    .replace(/ /g, "-");
}

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const marked = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const html = this.parser.parseInline(tokens);
      return `<h${depth} id="${slugify(html)}">${html}</h${depth}>\n`;
    },
    // Cross-doc links are written as sibling files (erddap.md#reason-codes) so
    // they work on GitHub; here they become in-app routes.
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
      const doc = DOC_LINK.exec(href);
      if (doc) {
        const route = `/harvest/docs/${doc[1]}${doc[2] || ""}`;
        return `<a href="${BASE}${route}" data-route="${route}"${titleAttr}>${text}</a>`;
      }
      if (href.startsWith("#")) {
        return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
      }
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${text}</a>`;
    },
  },
});

// Each doc opens with a "Harvest docs:" nav for GitHub readers; the page has tabs.
const GITHUB_NAV = /^> \*\*Harvest docs:\*\*.*(\n>.*)*\n*/m;

export function renderHarvestDoc(markdown) {
  return marked.parse(markdown.replace(GITHUB_NAV, ""));
}
