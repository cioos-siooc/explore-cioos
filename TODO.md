# TODO

## Release blockers

### Bugs
- [x] Fix hexes at high latitude for trajectories — coverage is swept from the
      track itself (`trajectory_build_hexes`) instead of a 1/12-degree lat/lon
      grid whose latitude spacing outgrew the hex rows north of ~57N.
- [x] Fix click on map grid box / hex / marker interaction — one click handler
      for every layer, answered by the "what's here" card, instead of six
      handlers doing five unrelated things behind a stand-aside ladder.
- [ ] Update hexes colormap base on visible hexes
- [ ] Make icons in dataset page vertically stacked
- [ ] Some records are duplicated within the dataset list for some reason. 
- [ ] Filter UI have a select all and reset button which are basically doing the same thing. Just keep a clear button
- [ ] Make bigger markers always site above smaller markers.

### Map interaction follow-ups
- [ ] Give the datasets sheet a mid snap point on phones, so the list and the
      map are visible together. Deliberately left alone for now: the sheet drag
      was removed on purpose in "on phones the sheet waits to be asked for".
- [ ] Long-press on the map as "add everything here" without opening the card.

### Downloader — test and fix
- [ ] Trajectory
- [ ] Griddap
- [ ] Points
- [ ] OBIS

## New features
- [ ] Add Optional Banner to present to user the very first time for form or question with markdown and date limit option.

### Dataset types & integrations
- [x] Integrate full trajectory dataset view from Richard.
- [ ] Add Point type datasets, add flag for large Point datasets. Some datasets are wrongly defined as Point datasets while they are more likely something else.

### Onboarding
- [ ] Implement a welcome walkthrough with a step-by-step UI integration.

## Infrastructure & backend
- [ ] Fix docker compose handling with override or not.
- [ ] Drop db migration container.
- [ ] Review prefect-worker container.
- [ ] Test redis caching refresh.
- [ ] Review DB partial load of table and improve efficiency and stability.
- [x] Drop log message "i18next is made possible by our own product, Locize".

### Database & harvesting (see docs for reference)
- [x] Improve dataset incremental upload to db.
- [x] Improve database indexing for speeding up calls.
- [x] Harvester incremental update freezes the database and frontend on load — avoid doing that.

## Testing
- [ ] Add frontend testing for the different items:
    - [ ] URL parametrization
    - [ ] UI filters
    - [ ] Download page
    - [ ] Grouping
    - [ ] Sort by datasets
    - [ ] Globe view
    - [ ] Gridded data view
    - [ ] Legend

## Compliance & cost
- [ ] Do we need a cookie-accept prompt for this site?
- [ ] Review Mapbox terms and services to see if we're still within the low-cost range.

## Open questions for reviewers
- [x] Should we add more map backgrounds?
- [x] Should we use only a single map background?
- [ ] Should we default to globe view?
- [ ] Group by source should separate by the different ERDDAP servers.
- [ ] Review UI logic of dataset selected / filter activated / defaults / WMS servers.
- [ ] Should we add a link to the harvest pages in the main ui?
---

## ✅ Completed

### Bugs
- [x] Why when no filters active we get 1832/1834 still.
- [x] Fix spinners and hide dataset count on load.

### Review passes
- [x] Review WMS layer interaction with dataset info view.
- [x] Review single dataset view and map interaction.
- [x] Review download modal.

### UI polish
- [x] Remove duplicated rows in dataset table.
- [x] In dataset cards make the dot inline with the first line of the title.
- [x] Add debounce when hover over dataset list and map highlight to avoid flickering all/one dataset.
- [x] Make download button border radius match the dataset list border radius.
- [x] Make brandCard fixed width to have same width for both languages.
- [x] Move the apiErrorBanner to the bottom of the page.
- [x] Popup time filter when you click on the time filter badge.
- [x] Same with depth filter.

### Features
- [x] Integrate OBIS in trajectory hexes on high zoom level.
- [x] Highlight visible datasets in viewport within datasets list.
- [x] Add groupby feature in dataset view with group separators.
- [x] Add single dataset view url parametrization and wms variable/date/depth selected.
- [x] Accept url with no lat/long/zoom but a dataset and zoom to this specific dataset location.
- [x] Only show in legend visible platform type.
- [x] Use Feedback form from Sentry.
