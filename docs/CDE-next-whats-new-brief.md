# CDE — What's New in the Next Release

**Prepared for:** CIOOS Directors  |  **Date:** 2026-07-30
**Scope:** `feat/harvest-dashboard` (release candidate) vs. `master` (production) — 362 commits, ~45,000 lines across the map interface, data pipeline, and API

The largest change to the Data Explorer since launch. Three things change for users: the
catalogue covers much more of the ocean; the interface is map-first; and it is faster, with
real visibility into the harvest when it breaks. Both official languages are maintained.

## 1. New kinds of data

**Trajectories (moving platforms)** — previously excluded entirely. Gliders, ships, ferries,
drifters, and Argo appear either as coverage hexagons shaded by how many tracks crossed each
cell, or as the actual **track lines**, with a time scrub bar and a selectable history window
(7 days to all time). Per-day breadcrumbs and direction arrowheads at high zoom; click a track
to draw that platform's full path. Tracks are **split at data gaps** rather than drawn as
straight lines across outages.

**Gridded datasets (griddap)** — model output, satellite products, and reanalyses are
discoverable for the first time: coverage footprints, full grid structure (dimensions, nodes,
resolution, tagged variables), and an optional **live WMS preview** with time and depth
sliders. Gridded data is downloaded on ERDDAP, and the interface says so.

**OBIS biodiversity** — occurrence density hexagons, filtering by scientific **or common** name
("killer whale" → *Orcinus orca* via WoRMS, French included), and filtering by OBIS node.
Scoped to Canadian waters, except OBIS Canada and OTN-OBIS, harvested worldwide.

**Finer existing types** — the single "profiles" layer splits into Profiles (CTD casts),
Timeseries / fixed stations, and Timeseries profiles, each independently toggleable.

## 2. Redesigned, map-first interface

- The map fills the window. A **full-height dataset list** with download pinned at its bottom;
  **Filters** and **Download** as modals; active filters as removable chips.
- Rebuilt on the **CIOOS National design system**, so CDE matches the rest of the estate.
- **EMODnet bathymetry** as new default base layer, plus Esri Ocean and a **3D globe** toggle.
- One **Map layers** panel for every layer and the legend; layer toggles also narrow the dataset
  list and its counts, so map and list always agree. "Zoom to dataset" on any dataset.
- Dataset list: search, sort, **group by** organization / variable / source, and an **"In view"**
  toggle with live counts.
- Filters grouped into **What / From / When & Where / Biodiversity**, with ERDDAP servers and
  OBIS nodes merged into one searchable **Data Portal** filter.
- **Every filter, plus map position, zoom, selection, and WMS variable/time/depth, is in the
  URL** — a CDE view is now shareable and bookmarkable. Preferences persist between visits.
- **Download modal** restates dataset titles, applied filters, and per-dataset size estimates
  (filtered and unfiltered), with an **External download** column to ERDDAP where needed.
  **Trajectory data is now downloadable through the basket.**
- In-app bilingual **feedback form** with optional screenshot; a retry banner when the data
  service is unreachable; a **mobile viewport** (previously absent); accessibility and
  cross-browser passes.

## 3. Speed and reliability

| Change | Effect |
|---|---|
| Spatial pre-filter on hex map tiles | ~2.5 s → **under 0.4 s** per tile |
| Redis caching fixed (was silently inactive); estimates and record lists cached | Repeat views and re-opened datasets are instant |
| New indexes; zoom-gated dense track symbols | Long time windows no longer crash the tab |
| Incremental harvesting via content hashes; locking reworked | Unchanged datasets verified in one request; concurrent harvests no longer serialise |
| **No more wipe-and-rebuild loads** | Loads are proportional to what changed — **CDE stays live while it updates** instead of timing out |

## 4. New Harvest Status area (team-facing)

A bilingual operator view of what the nightly harvest actually did: per-source counts (OK,
unchanged, skipped, errored) with run-history sparklines; **top failure reasons** in plain
language; per-dataset attempt history with request URLs, error detail, content hash, and
last-check vs. last-update; per-run duration, scope, trigger, and Git SHA; and a **"hashable"**
badge showing which datasets support cheap incremental checks. Not currently linked from the
public interface — whether to expose it is an open decision.

## 5. Under the hood

Frontend build modernised (Vite), MapLibre GL 2 → 5 (what enables the globe), core libraries
brought current, unmaintained dependencies removed. The harvester is reorganised around a
**dataset-type registry** — a new data type is one handler, not a pipeline edit. Test coverage
went from minimal to a substantial suite across harvester, loader, and downloader.

## 6. Why the production catalogue is currently stale

**The old harvest model is all-or-nothing.** Production can only rebuild the entire database
on every harvest, so **any dataset that fails in a run disappears from the catalogue** until a
later run succeeds. Failures were frequent over the last several months for reasons outside
the data: source **catalogues attacked and intermittently down over the winter**; **Cloudflare
protection** enabled in front of some partner ERDDAPs, which blocks harvesting; and
**migration to new ERDDAP instances** resetting the max response time to the 30 s default when
several of our queries legitimately take **over 15 minutes**. The result was repeated loss of
RA and partner datasets with no way to keep the last good copy. **This release fixes it** —
incremental harvesting, failures no longer delete datasets, and Harvest Status (§4) makes each
cause visible per dataset.

**CIOOS-CO has had nowhere appropriate to deploy.** We are **still on SLGO's Azure
infrastructure**, never intended as our long-term home. We have been waiting on **Alliance /
Calcul Québec since January 2026**: a temporary service only in **May** (itself troubled), and
a more permanent allocation in **late June**. July vacations and conferences have made the
migration window hard to secure. The **Micrologic** alternative depends on SLGO finishing its
own migration and on SLGO staff availability — **still waiting**.

**Plan:** migrate to the **Calcul Québec Juno node mid-August 2026** for testing, redirect
production **late August** if it performs well, or move to **Micrologic** if Juno proves
unsuitable.

## 7. Known gaps before release

- **End-to-end download verification** for the new types (trajectory, gridded, point, OBIS).
- **Trajectory hexagons render incorrectly at high latitudes** — open bug.
- **Point-type datasets** unsupported; some datasets mis-declared as Point upstream.
- **Frontend automated tests** for URL parameters, filters, grouping, and gridded views.
- **A guided first-visit walkthrough** — the interface has changed substantially and the new
  data types add controls with no equivalent today, so returning users need one.
- **Load testing not done.** Gains above are per query and per tile, not under concurrent
  traffic, and the new layers are heavier than production serves today.
- **A consolidated pass on end-to-end UI workflows** (discover → filter → inspect → select →
  download) for dead ends and inconsistencies between map, list, and basket.
- Compliance: whether a **cookie-consent prompt** is required, and whether **map-tile usage
  stays in the low-cost tier**.
