import { useEffect, useMemo, useState } from "react";

import { server } from "../../../config.js";

// The profiles inside one record, so the preview can step to any of them.
//
// A TimeSeriesProfile record is a station holding many casts and a
// TrajectoryProfile record is a track holding many profiles, but /preview
// answers with a 1000-row window taken from the TAIL of the record — 7 casts of
// the Viking station's 335, and 16 of the ADCP record's 48166, one of them cut
// in half by the row cap. Stepping through that window would be stepping
// through an arbitrary sliver, so the list comes from the server, which reads
// it straight from ERDDAP.
//
// Fetched here rather than inside the lazy Plotly chunk so it is in flight while
// the ~1.1 MB of plotly is still downloading.
//
// A failure is not an error state: no steps means no slider, and the plot is
// exactly what it was before this existed. /preview reports anything that is
// genuinely wrong with the record.

const NO_PROFILES = { column: null, steps: [], count: 0, truncated: false };

// \u0000 cannot occur in either half, so no pair of ids can collide.
const keyFor = (datasetId, recordId) =>
  datasetId && recordId ? `${datasetId}\u0000${recordId}` : null;

export default function usePreviewProfiles(datasetId, recordId) {
  const recordKey = keyFor(datasetId, recordId);
  // Stored WITH the record it describes rather than cleared by an effect on the
  // way in: the answer is then derived below, so there is no render in which a
  // new record is described by the previous one's casts.
  const [loaded, setLoaded] = useState({ key: null, profiles: NO_PROFILES });

  useEffect(() => {
    if (!recordKey) return undefined;
    // A record switched while this was in flight must not be described by it.
    let current = true;

    fetch(
      `${server}/preview/profiles?dataset=${encodeURIComponent(
        datasetId,
      )}&profile=${encodeURIComponent(recordId)}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((body) => {
        if (!current) return;
        setLoaded({
          key: recordKey,
          profiles: body && Array.isArray(body.steps) ? body : NO_PROFILES,
        });
      });

    return () => {
      current = false;
    };
  }, [recordKey, datasetId, recordId]);

  return useMemo(
    () => (loaded.key === recordKey ? loaded.profiles : NO_PROFILES),
    [loaded, recordKey],
  );
}
