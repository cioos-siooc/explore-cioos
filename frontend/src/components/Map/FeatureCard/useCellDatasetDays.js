import { useEffect, useState } from "react";

import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";
import { buildTileSuffix } from "../tileQuery.js";

// A hex's `count` is a UNION of its datasets' day sets, so per-dataset figures
// can't be derived from the tile; /tiles/datasets re-aggregates the rows.
// Fetched per click rather than baked into tiles: that measured +19% on /tiles
// and +41% on /tiles/cells per cache miss, versus ~70 ms per click here.
// Empty while in flight or on failure, so a miss renders no figure rather than
// a wrong one.
const EMPTY = new Map();

// Clicking along a coastline walks back and forth over the same few hexes, so
// answers are kept; the card outlives any one click. Bounded because the key
// includes the filter set, which a session can change many times.
const MAX_CACHED_RESPONSES = 30;

export default function useCellDatasetDays(query, combinedQueries, dataLayers) {
  // Answers keyed by url (space-joined when a click takes two). State rather
  // than a ref because it is read during render: a url already answered
  // renders its figures on the first pass.
  const [answers, setAnswers] = useState(EMPTY);

  const buckets = query?.buckets;
  const hexes = buckets?.hexPks?.join(",") || "";
  const points = buckets?.pointPks?.join(",") || "";

  // A marker-click query carries no items or buckets. A coverage hex's markers
  // are profiles only the main source has, so that click takes one request per
  // source.
  let url = null;
  if (hexes || points) {
    // The tiles' own suffix, so the metric and layer switches cannot drift.
    const suffix = buildTileSuffix(combinedQueries, dataLayers).replace(
      /^\?/,
      "",
    );
    const urlFor = (source, key, pks) => {
      const params = new URLSearchParams(suffix);
      params.set("z", buckets.z);
      params.set("source", source);
      params.set(key, pks);
      return `${server}/tiles/datasets?${params.toString()}`;
    };
    url = [
      hexes && urlFor(buckets.source || "main", "hexes", hexes),
      points && urlFor("main", "points", points),
    ]
      .filter(Boolean)
      .join(" ");
  }

  useEffect(() => {
    if (!url || answers.has(url)) return undefined;

    const controller = new AbortController();
    const remember = (byPk) =>
      setAnswers((prev) => {
        const next = new Map(prev).set(url, byPk);
        // Map iterates in insertion order, so the first key is the oldest.
        if (next.size > MAX_CACHED_RESPONSES) {
          next.delete(next.keys().next().value);
        }
        return next;
      });

    Promise.all(
      url.split(" ").map((part) =>
        fetch(part, { signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        }),
      ),
    )
      .then((responses) =>
        remember(new Map(responses.flat().map((row) => [row.pk, row.count]))),
      )
      .catch((error) => {
        if (error.name === "AbortError") return;
        reportError("tiles/datasets fetch failed", error);
        // Remembered as empty so a failing cell is not re-requested on every
        // render; the card shows no figure, which is the honest answer.
        remember(EMPTY);
      });
    return () => controller.abort();
  }, [url, answers]);

  // Derived, not held: a new click shows no figure until its own answer lands,
  // rather than briefly showing the last cell's.
  return (url && answers.get(url)) || EMPTY;
}
