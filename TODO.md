# TODO

## 1. Release blockers

### Bugs
- [x] Why when no filters active we get 1832/1834 still.
- [x] Fix spinners and hide dataset count on load.
- [ ] Fix hexes at high latitude for trajectories.

### Downloader — test and fix
- [ ] Trajectory
- [ ] Griddap
- [ ] Points
- [ ] OBIS

### Review passes
- [x] Review WMS layer interaction with dataset info view
- [x] Review single dataset view and map interaction
- [x] Review download modal

## 2. UI polish

### Dataset list & cards
- [x] In dataset cards make the dot inline with the first line of the title.
- [x] Add debounce when hover over dataset list and map highlight to avoid flickering all/one dataset
- [x] Make download button border radius match the dataset list border radius
- [x] Make brandCard fixed width to have same width for both languages
- [x] Move the apiErrorBanner to the bottom of the page.
- [ ] Remove duplicated rows in dataset table 

### Filters
- [x] Popup time filter when you click on the time filter badge
- [x] Same with depth filter

## 3. Infrastructure & backend
- [ ] Fix docker compose handling with override or not
- [ ] Drop db migration container
- [ ] Review prefect-worker container
- [ ] Test redis caching refresh
- [ ] Review DB partial load of table and improve efficiency and stability
- [ ] Drop log message "i18next is made possible by our own product, Locize"

## 4. Compliance & cost
- [ ] Do we need cookies accept prompt for this site?
- [ ] Review mapbox terms and services to see if we're still within the low cost range.

## 5. New features

### Dataset types & integrations
- [ ] Integrate full trajectory dataset view from Richard
- [ ] Add Point type datasets, add flag for large Point datasets
- [x] Integrate OBIS in trajectory hexes on high zoom level.

### Dataset list & map
- [x] Highlight visible datasets in viewport within datasets list.
- [x] Add groupby feature in dataset view with group separators
- [x] Add single dataset view url parametrization and wms variable/date/depth selected
- [x] Accept url with no lat/long/zoom but a dataset and zoom to this specific dataset location.
- [x] Only show in legend visible platform type

### Onboarding & feedback
- [ ] Implement a welcome walkthrough with a UI step by step integration.
- [x] Use Feedback form from Sentry

## 6. Questions for reviewers
- [ ] Should we add more map backgrounds?
- [ ] Should we use only a single map background?
- [ ] Should we default to globe view?

## 7. Added
- [ ] Add frontend testing for the different items
    - [ ] URL parametrization
    - [ ] UI filters
    - [ ] Download page
    - [ ] Grouping 
    - [ ] Sort by datasets
    - [ ] Globe view
    - [ ] Gridded data view
    - [ ] Legend
    - [ ] ....
- [ ] Improve dataset incremental upload to db. See docs for reference
- [ ] Improve database indexing for speeding up calls see docs
- [ ] Group by source should seperate by the differetn erddap servers  