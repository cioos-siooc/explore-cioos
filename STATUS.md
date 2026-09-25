# CIOOS Data Explorer — status

Where the app stands on `development-v2` as of September 2026. For how to
run, configure and deploy it, see the [README](README.md).

## What it is

A map-first catalogue of Canada's ocean data. It harvests dataset metadata from
ERDDAP™ servers, OBIS and the CIOOS CKAN catalogue into PostgreSQL/PostGIS, and
lets anyone find datasets on a map, narrow them down, and download them, either
as an archive emailed to them or straight from the server that publishes them.
The interface is bilingual (English/French) and written for a general audience,
not only specialists.

## Data

| Source             | What is harvested                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| ERDDAP™ (tabledap) | Profiles, time series, time-series profiles, trajectories (gliders, ships), point datasets; each feature's position, time and depth range |
| ERDDAP™ (griddap)  | Gridded datasets, catalogued and drawn as a coverage layer, but not downloadable through the Explorer (users are sent to the source)      |
| OBIS               | Occurrence datasets, as hex cells with the days sampled, filterable by scientific name                                                    |
| CKAN               | Titles, organizations, ocean variables (EOVs) and links, matched to the ERDDAP datasets they describe                                     |

Harvests are Prefect flows (full, per source, incremental), scheduled per
deployment. A `Rebuild Database` flow handles schema changes.

## Features

- **Map**: hexagons coloured by how many days of data they hold, turning into
  individual stations at close zoom; trajectory tracks; gridded coverage;
  NONNA bathymetry and satellite basemaps; flat or globe projection.
- **Click anywhere** for what was measured there and by which datasets; a
  single station opens its record directly.
- **Search and filters**: keyword, ocean variables, organizations, platforms,
  ERDDAP™ servers, OBIS nodes, scientific names, time and depth ranges,
  real-time only, a drawn box or polygon. Filters show as removable chips.
- **Shareable links**: the address carries the filters and map view, so a copied
  link reopens the same view (modals and the sidebar are not in the link yet).
- **Coverage histogram**: how much data was collected over time, grouped by
  source, organization and more.
- **Downloads**: select datasets, review sizes against the 1 GB-per-dataset
  limit, then either queue a prepared archive (link emailed when ready) or take
  direct ERDDAP™/OBIS links, a URL list or a curl script.
- **Help**: a plain-language About window with guided showcases, contextual tips
  and a short tour, and a feedback form.
- **Harvest dashboard** (`/harvest`, staff only): per-server and per-dataset
  harvest results, runs, and the download queue.

## Privacy and data handling

Built to meet Quebec's Law 25 and the EU's ePrivacy/GDPR rules without a
consent banner. The in-app **Privacy** notice (About window, download form) is
what users read; this is the technical summary.

| What                | How it is handled                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cookies             | None. Preferences (language, map layers, projection, tips seen, About seen) live in the browser's localStorage and never reach the server. |
| Download email      | Sent in the request body, never a URL. Remembered on the device only if the user asks. Deleted 7 days after the job finishes.              |
| Download statistics | Job rows are kept, with the email's domain (e.g. `uvic.ca`) but not the address.                                                           |
| Visit counts        | Plausible, run by CIOOS: no cookies, no personal data. A `Download submitted` event records the dataset count and language.                |
| Errors and feedback | Sentry (hosted in the US). No IP addresses, no request bodies; feedback email is optional.                                                 |
| Fonts               | Served from our own site (no Google Fonts).                                                                                                |
| Map tiles           | Loaded directly from EMODnet, OpenFreeMap and Esri, which see the viewer's IP like any website.                                            |

**Still to do outside the code:** publish the title and contact of the person
in charge of personal information; complete the privacy impact assessment Law 25
requires for the transfer to Sentry in the US; stop the sending Gmail account
keeping copies of download emails.

## Deployments

| Environment | Where                                                               | Ships                                  |
| ----------- | ------------------------------------------------------------------- | -------------------------------------- |
| dev/staging | `explore-v2.cool.juno.cioos.ca` (Coolify, behind Cloudflare Access) | `development-v2`                       |
| PR previews | `explore-pr-<N>.cool.juno.cioos.ca`                                 | frontend of each PR, on the dev-v2 API |
| production  | self-hosted, via the Deploy workflow                                | `master`                               |

`development-v2` is the v2 app described here; it is several hundred commits
ahead of `master` and not yet released to production.

## Quality

- Unit and route tests in every service; frontend e2e (Playwright) on desktop,
  tablet and mobile, plus visual-regression and accessibility baselines.
- Docker healthchecks on every service, and `/api/health/ready` for the
  database and download queue.
- Errors and failed harvests/downloads reported to Sentry, grouped by cause.

## Known limitations

- Gridded (griddap) datasets can be found but not downloaded through the
  Explorer.
- Datasets larger than 1 GB after filtering can't be packaged; the direct link
  is the way to get them.
- Polar projections aren't possible with MapLibre.
- Modal and sidebar state are not yet part of the shareable link.
