import { initialBearing, splitTrackRuns } from "../../utilities";

// The selected platform's path (LineStrings) and raw fixes (Points), clipped
// to the time filter so the track agrees with every count on the page. The
// response is time-ordered, so the window is one contiguous slice; a missing
// fix time stops the walk rather than clipping, so a track without times
// draws whole.
export function selectedTrackFeatures(
  { coordinates: rawCoordinates = [], times: rawTimes = [], profileIds },
  { min, max },
  { trajectoryId, datasetTitle },
) {
  let from = 0;
  let to = rawCoordinates.length;
  if (min !== undefined) {
    while (from < to && Date.parse(rawTimes[from]) < min) from++;
  }
  if (max !== undefined) {
    while (to > from && Date.parse(rawTimes[to - 1]) > max) to--;
  }
  const coordinates = rawCoordinates.slice(from, to);
  const times = rawTimes.slice(from, to);
  const clippedProfileIds = profileIds?.slice(from, to);

  // Same segmentation rule as the /tiles/tracks layer.
  const runs = splitTrackRuns(coordinates, times);
  const lineFeatures = runs
    .filter((run) => run.length >= 2)
    .map((run) => ({
      type: "Feature",
      geometry: { type: "LineString", coordinates: run },
      properties: {},
    }));
  // Bearings never span run breaks (a data gap or the antimeridian); cog
  // stays unset for a single-fix run, which the -nocog circle layer picks
  // up. The running cursor recovers each point's fix time, since runs
  // partition the clipped coordinates in order.
  let fixIndex = 0;
  const fixFeatures = runs.flatMap((run) => {
    let lastCog = null;
    return run.map((coordinate, i) => {
      const time = times[fixIndex];
      const profileId = clippedProfileIds?.[fixIndex];
      fixIndex++;
      const cog =
        i > 0
          ? initialBearing(run[i - 1], coordinate)
          : run.length > 1
            ? initialBearing(coordinate, run[1])
            : null;
      if (cog !== null) lastCog = cog;
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: coordinate },
        properties: {
          ...(lastCog === null ? {} : { cog: lastCog }),
          ...(profileId ? { profile_id: profileId } : {}),
          time,
          trajectory_id: trajectoryId,
          dataset_title: datasetTitle,
        },
      };
    });
  });
  return [...lineFeatures, ...fixFeatures];
}
