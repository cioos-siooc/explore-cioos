# CEDA API Endpoints

## /pointQuery

Either pointPKs or polygon is required. If any other variable is left out it will include all data for that variable.

- timeMin
- timeMax
- depthMin
- depthMax
- polygon
- eovs
- organizations
- pointPKs

## /download

Downloader requires a polygon

- timeMin,
- timeMax,
- depthMin,
- depthMax,
- polygon,
- eovs,
- organizations,
- datasetPKs,

Note: latMin/latMax/lonMin/lonMax are supported in the API but have been left out as they aren't part of the UI
