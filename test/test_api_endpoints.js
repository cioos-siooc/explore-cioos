import assert from "assert";
import fetch from "node-fetch";
/***
 *
 * Check that the API returns data for all endpoints
 *
 */

// url of frontend
const API_URL = "http://localhost:8098/api";

const cdeQuery = (url) => {
  const fullUrl = API_URL + url;
  console.log("Requesting:", fullUrl);
  return fetch(fullUrl).then((res) => res.json());
};

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

  assert(datasets.length == 2, "datasets.length != 2 ");
  assert(Object.values(legend.recordsCount).length == 3, "legend.length != 3 ");
  assert(organizations.length == 2, "organizations.length != 2 ");
  assert(oceanVariables.length == 1, "oceanVariables.length != 1: oceanVariables.length = " + oceanVariables.length);
  assert(pointQuery.length == 2, "pointQuery length != 1: pointQuery.length = " + pointQuery.length);
  assert(tiles.byteLength > 2000), "tiles.byteLength < 2000";
  assert(preview.table.rows.length > 100), "preview.table.rows.length < 100";
})();
