import { Marked } from "marked";

// Abstracts and lineage are written by the data's publishers (CKAN notes are
// markdown, ERDDAP summaries plain text), so this is untrusted input going into
// innerHTML: raw HTML is shown as text, and links keep only safe schemes.
const SAFE_HREF = /^(https?:|mailto:)/i;

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const marked = new Marked({
  // Plain-text sources break lines with single newlines; keep them.
  breaks: true,
  renderer: {
    html({ text }) {
      return escapeHtml(text);
    },
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!SAFE_HREF.test(href)) return text;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    // No remote images on the page; the alt text stands in.
    image({ text }) {
      return escapeHtml(text);
    },
  },
});

export function renderMarkdown(text) {
  return marked.parse(text, { async: false });
}
