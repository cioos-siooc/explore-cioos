# CDE — What's New in the Next Release

**Prepared for:** CIOOS Directors
**Date:** 2026-07-30
**Scope:** `feat/harvest-dashboard` (release candidate) compared to `master` (production)
**Size of change:** 362 commits, ~45,000 lines added across the map interface, data pipeline, and API

---

## Executive summary

This release is the largest change to the CIOOS Data Explorer since launch. Three things
change from a user's point of view:

1. **The catalogue covers much more of the ocean.** CDE previously showed only profile-type
   and fixed-station data from ERDDAP. It now also shows **moving platforms** (gliders,
   ships, ferries, floats), **gridded model and satellite products**, and **marine
   biodiversity occurrence records from OBIS** — a global network CDE did not previously
   touch at all.
2. **The interface is map-first.** The map is now the whole page. Filters, the dataset list,
   and the download basket are panels over the map rather than a stack of controls around
   it. Any view can be shared as a URL.
3. **It is faster, and we can now see when it breaks.** Map tiles that took ~2.5 s now
   render in under 0.4 s; the site stays live while new data loads instead of timing out;
   harvests skip datasets that have not changed; and a new
   **Harvest Status** section gives the team a per-source, per-dataset audit trail instead
   of guessing from logs.

Both official languages (English and French) are maintained throughout.

---

## 1. New kinds of data in the Explorer

### 1.1 Trajectories — moving platforms
Previously excluded from CDE entirely. Now a first-class data type covering `Trajectory`
and `TrajectoryProfile` datasets (gliders, ships of opportunity, ferries, drifters, Argo).

Users can:
- See **where moving platforms have been**, as coverage hexagons shaded by how many
  trajectories crossed each cell (a distinct purple scale, so it never reads as profile data).
- Switch to **track lines** — the actual paths drawn on the map, with a **time scrub bar**
  docked at the bottom of the map.
- Choose how much history to trail behind the selected date: 7, 14, 30, 90, 180 days,
  1 year, or **all time**. (90 days is the default; longer windows load fully once zoomed in.)
- See **per-day breadcrumb dots** along a track at higher zoom, with **direction arrowheads**
  showing course over ground, and hover tooltips on each fix.
- **Click a track to highlight that platform and draw its complete path**, regardless of the
  current time window.
- Browse a **platform list** for a trajectory dataset and click any platform to draw its
  full track.

Tracks are correctly **split at data gaps** rather than drawn as straight lines across
outages — a common source of misleading maps in other portals.

### 1.2 Gridded datasets (griddap)
Model output, satellite products, and reanalyses are now discoverable in CDE for the
first time.

Users can:
- See **coverage footprints** of gridded datasets on the map, and click one for details.
  Where footprints overlap, a picker lets the user choose which dataset they meant.
- View the **grid structure** — dimensions, number of nodes, min/max, and resolution per
  axis — plus the full variable list, tagged with the ocean variables they represent.
- Turn on a **live map preview (WMS)** for a chosen variable, with **time and depth
  sliders** and the dataset's own colour legend.
- Follow a direct link to the dataset on ERDDAP. Gridded data is accessed on ERDDAP rather
  than through the CDE download basket, and the interface says so clearly.

### 1.3 OBIS marine biodiversity
CDE now harvests the **Ocean Biodiversity Information System**, adding species occurrence
records alongside physical oceanographic data.

Users can:
- See **occurrence density** as coverage hexagons on an amber scale. Where OBIS and
  trajectory coverage overlap in the same cell, a third (plum) scale is used so a mixed
  hexagon is never mistaken for either one.
- Filter by **Scientific Name** — and critically, **by common name too**. Typing
  "killer whale" resolves to *Orcinus orca* via the World Register of Marine Species
  (WoRMS), including French common names.
- Filter by **OBIS node** (e.g. OBIS Canada, OTN-OBIS, EurOBIS, OBIS-USA), either as a
  whole or node by node.
- Open any OBIS dataset on the OBIS portal directly.

**Geographic scoping:** OBIS occurrences are limited to Canadian waters (EEZ plus Canadian
land territory) to keep the catalogue relevant and the database manageable. Datasets
contributed through **OBIS Canada** and **OTN-OBIS** are exempt and harvested in full,
wherever in the world they occurred.

### 1.4 Finer distinction among existing types
What was previously one "profiles" layer is now split into **Profiles (CTD casts)**,
**Timeseries / fixed stations**, and **Timeseries profiles**, each independently
toggleable. Users looking for moored records no longer have to sift them out of ship casts.

---

## 2. A redesigned, map-first interface

### 2.1 Layout
- The **map fills the window**. Everything else floats above it.
- A **full-height dataset list** on the left, collapsible, with the download action pinned
  at its bottom.
- **Filters** open as a modal from a single button at the top-left; **Download** likewise.
  Both apply to the map immediately.
- **Active filters appear as removable chips** beside the Filters button. Clicking a chip
  jumps to that filter; each chip can be cleared individually or as a group.
- Rebuilt on the **CIOOS National design system** (shared colour, type, and spacing tokens)
  rather than ad-hoc styling, so CDE now visually matches the rest of the CIOOS estate.

### 2.2 The map itself
- **Two base layers**: EMODnet bathymetry (new default, far better seafloor context) and
  Esri Ocean.
- **Globe view** — a true 3D globe projection toggle, which persists between visits.
- A consolidated **Map layers** panel holding every data-layer toggle and the legend,
  replacing the previous floating layer selector.
- **Data-layer toggles now narrow the dataset list and its counts**, so what is on the map
  and what is in the list always agree.
- **"Zoom to dataset"** button on any dataset, framing the map to its full extent.
- A **"Updating map…"** indicator so users know a slow query is progressing rather than broken.

### 2.3 Finding datasets
- **Search by title** at the top of the dataset list.
- **Sort** by title, platform, or downloadability, ascending or descending.
- **Group by** organization, ocean variable, or source, with group headers — and each group
  can be **hidden from the map** to declutter without changing the filters.
- **"In view"** toggle: show only datasets inside the current map view, with a live count.
- Datasets are shown as **cards** with platform icons, selection state, and a clear
  "Select for download" affordance — the same card is used in the sidebar and in the
  download basket, so the selection is recognisable in both places.

### 2.4 Filters
- Filters are now organised into four labelled groups: **What**, **From**,
  **When & Where**, and **Biodiversity**.
- ERDDAP servers and OBIS nodes are merged into one **Data Portal** filter with a
  searchable tree — users pick sources by name rather than needing to know which
  federation a dataset came from.
- Every filter, plus the map position, zoom, selected dataset, and even the selected WMS
  variable/time/depth, is **captured in the URL**. A CDE view is now a shareable,
  bookmarkable link — directly useful for reports, tickets, and teaching.
- Filter and layer preferences **persist between visits**.

### 2.5 Download experience
- A dedicated **Download modal** that restates what is being ordered: dataset titles, the
  **applied filters**, and per-dataset **size estimates** (both filtered and unfiltered, so
  users see what the filter saved them).
- An **External download** column linking to ERDDAP for datasets too large for, or not
  supported by, the CDE download service.
- Size estimates now **fail gracefully** — a failing estimate shows "—" instead of an
  infinite spinner, which was a real source of confusion.
- **Trajectory data is now downloadable through the basket**: selecting an area over a
  glider or ship track correctly queues that dataset, which it did not before.
- Download packaging is more robust: interrupted jobs no longer block retries, and
  temporary files are cleaned up properly.

### 2.6 Help, feedback, and error handling
- The **introduction panel** has been rewritten to match the new interface, and can be
  reopened at any time from the dataset list.
- A **Feedback button** (chat icon) opens a short bilingual form — message, name, email,
  and an **optional screenshot** — routed to our error/feedback tracking. Users can now
  report a problem from inside the tool with the page state attached.
- If the data service is unreachable, users get a **clear banner with a Retry button**
  instead of a silently empty map.
- Loading states, spinners, and dataset counts are consistent across the app.

### 2.7 Mobile and accessibility
- The app now **declares a mobile viewport** — it previously rendered at desktop scale on
  phones.
- Draggable sidebar on touch devices; layers section starts collapsed on narrow screens.
- A dedicated pass on **keyboard navigation and accessibility**, and on
  **cross-browser compatibility**.

---

## 3. Speed and reliability

| Change | User-visible effect |
|---|---|
| Spatial pre-filter on hex-aggregation map tiles | ~2.5 s → **under 0.4 s** per tile; panning and zooming feel responsive |
| Redis caching fixed (it was silently doing nothing) | Repeat views served from cache |
| Download estimates and dataset record lists cached | Re-opening a dataset is **instant** instead of re-querying |
| New database indexes; zoom-gated rendering of dense track symbols | Long time windows no longer crash the browser tab |
| Incremental harvesting via content hashes | Unchanged datasets are verified with one request instead of being fully re-queried |
| Harvest locking reworked | Concurrent harvests no longer serialise behind each other |
| **The site stays up during data loads** | Previously a harvest load rebuilt the whole database and users saw timeouts. Loads are now proportional to what actually changed, and the nightly refresh no longer wipes and rebuilds — **CDE stays live while it updates** |

---

## 4. New Harvest Status section (team / operator facing)

CDE previously offered no visibility into what the nightly harvest actually did. This
release adds a bilingual **Harvest Status** area:

- **Overview** — every data source in the harvest audit log, with counts of datasets OK,
  unchanged, skipped, and errored, plus a **sparkline** of recent run history.
- **Top failure reasons** across the catalogue, with plain-language labels
  ("Unsupported CDM type", "Response too large", "Missing required variables", …) instead
  of raw error codes.
- **Per-source** dataset lists, searchable and filterable by status.
- **Per-dataset attempt history**, including the exact request URLs used, error detail,
  content hash, and the distinction between **last check** and **last update**.
- **Per-run** detail: when it started and finished, duration, scope, what triggered it, and
  the code version (Git SHA) that ran.
- A **"hashable"** badge explaining, per dataset, whether it supports cheap incremental
  checks or must be fully re-queried each time — which is the main lever on harvest cost.

This turns "is the catalogue healthy?" from a log-reading exercise into a page anyone on
the team can open. It is not currently linked from the public interface; whether to expose
it publicly is an open decision.

---

## 5. Under the hood (brief)

Relevant only insofar as it affects longevity and support cost:

- Frontend build modernised (Vite), mapping library upgraded (MapLibre GL 2 → 5, which is
  what enables the globe), and the translation, error-tracking, and charting libraries
  brought current. Several unmaintained dependencies were removed.
- The harvester was reorganised around a **dataset-type registry** — adding a new data type
  now means writing one handler rather than editing the pipeline. This is how trajectories,
  gridded data, and OBIS were each added, and how future types (e.g. point datasets) will be.
- Test coverage went from minimal to a substantial unit and integration suite across the
  harvester, loader, and downloader.

---

## 6. Why the production catalogue is currently stale

The version in production has been unable to keep its catalogue current, for two independent
reasons — one in the software, one in the hosting. Both are addressed below.

### 6.1 The old harvest model is all-or-nothing

The production release can only **rebuild the entire database on every harvest**. There is no
way to update part of the catalogue. The consequence is that **any dataset that fails to
harvest in a given run simply disappears from the catalogue** until a later run succeeds — a
single bad night removes real datasets from the Explorer.

Over the last several months, failures were common, and not because of anything in the
datasets themselves:

- **Catalogue outages over the winter.** Several source catalogues were attacked and
  intermittently unavailable during the harvest window.
- **Cloudflare protection** was enabled in front of some partner ERDDAP servers, which
  blocks automated harvesting.
- **Migration to new ERDDAP instances** reset the maximum query response time back to the
  ERDDAP default of **30 seconds**. Several of our harvest queries legitimately take **over
  15 minutes** to return, so they now time out where they previously succeeded.

Together, this meant repeated loss of Regional Association and partner datasets from
production, with no mechanism to retain the previous good copy.

**This is fixed in the release described in this document.** Harvesting is incremental,
failures are retained rather than deleting the dataset, loads are proportional to what
changed, and the Harvest Status section (§4) makes each of the failure causes above visible
per source and per dataset instead of buried in logs.

### 6.2 CIOOS-CO has not had a production environment to deploy to

The second reason is that there has been nowhere appropriate to deploy the new release.

- CIOOS-CO is **still running on SLGO's Azure infrastructure**, which was never intended to
  be our long-term production home.
- We have been waiting on access to **Alliance / Calcul Québec since January 2026**. For a
  range of reasons on the Alliance side, we only obtained a **temporary service in May**,
  which has had its own problems, and a **more permanent allocation in late June**.
- **July vacations and conference commitments** across the team have made it difficult to
  secure the block of time the migration work needs.
- In parallel we investigated an **alternative deployment platform via Micrologic**, but that
  depends on SLGO completing its own migration and on SLGO staff availability to grant us
  access. **We are still waiting on that.**

**Plan:** full migration to the **Calcul Québec Juno node in mid-August 2026** for testing,
with redirection of production in **late August** if the platform performs well — or a move
to **Micrologic** instead if Juno turns out not to be appropriate.

---

## 7. Known gaps before release

Stated plainly, for planning purposes:

- **Download paths for the new data types still need end-to-end verification** —
  trajectory, gridded, point, and OBIS orders.
- **Trajectory hexagons render incorrectly at high latitudes** — an open bug.
- **Point-type datasets** are not yet supported, and some datasets are mis-declared as
  Point upstream.
- **Frontend automated testing** for the new URL-parameter, filter, grouping, and gridded
  views is not yet written.
- **A guided first-visit walkthrough** is still to be built. The interface has changed
  substantially from what returning users know, and the new data types (trajectories,
  gridded, OBIS) introduce controls with no equivalent in the current release — a
  step-by-step introduction is needed so the redesign does not cost us existing users.
- **Load testing has not been done.** The performance gains above are measured per query
  and per tile, not under realistic concurrent traffic. The new data types add
  substantially heavier map layers than the current release serves, so we should confirm
  headroom before announcing.
- **A general pass on UI workflows** is still outstanding — the individual screens are in
  place, but the end-to-end journeys (discover → filter → inspect → select → download)
  need a consolidated review for dead ends, redundant steps, and inconsistent behaviour
  between the map, the dataset list, and the download basket.
- Two compliance items to confirm: whether a **cookie-consent prompt** is required, and
  whether our **map-tile usage stays within the low-cost tier**.
