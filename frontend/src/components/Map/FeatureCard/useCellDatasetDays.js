import { useEffect, useState } from "react";

import { server } from "../../../config.js";
import reportError from "../../../state/reportError.js";
import { buildTileSuffix } from "../tileQuery.js";

// What each dataset under the click contributes to the cell's figure.
//
// The tile cannot answer this. A hex carries one `count` — the whole bucket's
// figure — and a flat list of the datasets in it, so the card used to hand
// every dataset that same number: a hex reading 1120 days made a one-day
// dataset and a 1115-day mooring both claim 1120. For the days metric the
// bucket total is a UNION of the datasets' day sets, so it is not divisible
// into per-dataset figures after the fact; only the rows behind it can be
// re-aggregated, which is what /tiles/datasets does.
//
// It is fetched per click rather than baked into every tile deliberately.
// Measured on dev, carrying the breakdown on the tiles cost +19% on /tiles and
// +41% on /tiles/cells for every cache miss — paid on every tile a pan touches,
// to serve a number only read when someone actually clicks a hex. The same
// answer costs ~70 ms once per click here, and is cached server-side like
// every other route.
//
// Returns a Map of dataset pk -> count: empty while the request is in flight,
// and if it fails. The card reads it with .get(), so a miss renders as no
// figure at all rather than a wrong one.
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

  // A marker-click query carries no items and no buckets (see Map.jsx's
  // handleMapClick): it opens the dataset page directly and the card has
  // nothing to list, so there is nothing to ask about either.
  //
  // The markers inside a clicked coverage hex are profiles, which only the
  // main source has, while the hex itself is asked of `cells` — so that click
  // takes one request per source. At any other zoom a click hits hexes or
  // markers, never both, and this is a single request as before.
  let url = null;
  if (hexes || points) {
    // buildTileSuffix is what the tile layers themselves are requested with,
    // so the metric and the layer switches cannot drift from the tile this is
    // describing — the whole point of asking the same question of the API.
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
