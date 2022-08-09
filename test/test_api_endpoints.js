import assert from "assert";
import fetch from "node-fetch";
/***
 *
 * Check that the API returns data for all endpoints
 *
 */

// url of frontend
const API_URL = "http://localhost:8098/api";

const cdeQuery = (url) => fetch(API_URL + url).then((res) => res.json());

(async () => {
  const datasets = await cdeQuery("/datasets");
  const legend = await cdeQuery("/legend");
  const oceanVariables = await cdeQuery("/oceanVariables");
  const organizations = await cdeQuery("/organizations");
  const tiles = await fetch(API_URL + "/tiles/2/1/1.mvt").then((tile) =>
    tile.arrayBuffer()
  );
  const pointQuery = await cdeQuery(
    "/pointQuery?latMin=49.3194&lonMin=-123.7531&latMax=49.3552&lonMax=-123.6982"
  );
  const preview = await cdeQuery(
    "/preview?profile=C44131&dataset=DFO_MEDS_BUOYS"
  );

  assert(datasets.length == 1, "datasets");
  assert(Object.values(legend.recordsCount).length == 3, "legend");
  assert(organizations.length == 1, "organizations");
  assert(oceanVariables.length == 1), "oceanVariables";
  assert(pointQuery.length == 1), "pointQuery";
  assert(tiles.byteLength > 2000), "tiles";
  assert(preview.rows.length > 100), "preview";
})();
