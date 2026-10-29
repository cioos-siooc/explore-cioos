import * as React from "react";
import escapeRegExp from "lodash-es/escapeRegExp";

import "./matchHighlightStyles.css";

// Split like the server splits the query, so "G. morhua" marks both words.
export default function MatchHighlight({ text, query }) {
  const words = (query || "")
    .split(/[\s.]+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  if (!text || words.length === 0) return text ?? null;
  // A capturing split puts the matches at the odd indices.
  return text.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, i) =>
    i % 2 ? (
      <mark key={i} className="matchHighlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
