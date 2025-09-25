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
  console.log("Testing API endpoints at ", API_URL);

  console.log("Testing /datasets")
  const datasets = await cdeQuery("/datasets");
  assert(datasets.length == 2, "datasets.length != 2 ");
  
  console.log("Testing /legend")
  const legend = await cdeQuery("/legend");
  assert(Object.values(legend.recordsCount).length == 3, "legend.length != 3 ");
  
  console.log("Testing /organizations")
  const oceanVariables = await cdeQuery("/oceanVariables");
  assert(oceanVariables.length == 1, "oceanVariables.length != 1: oceanVariables.length = " + oceanVariables.length);

  console.log("Testing /oceanVariables")
  const organizations = await cdeQuery("/organizations");
  assert(organizations.length == 2, "organizations.length != 2 ");
  
  console.log("Testing /tiles")
  const tiles = await fetch(API_URL + "/tiles/2/1/1.mvt").then((tile) =>
    tile.arrayBuffer()
  );
  assert(tiles.byteLength > 2000), "tiles.byteLength < 2000";

  console.log("Testing /pointQuery")
  const pointQuery = await cdeQuery(
    "/pointQuery?latMin=49.3194&lonMin=-123.7531&latMax=49.3552&lonMax=-123.6982"
  );
  assert(pointQuery.length == 2, "pointQuery length != 2: pointQuery.length = " + pointQuery.length);
  
  console.log("Testing /preview")
  const preview = await cdeQuery(
    "/preview?profile=C44131&dataset=DFO_MEDS_BUOYS"
  );
  assert(preview.table.rows.length > 100), "preview.table.rows.length < 100";

})();
