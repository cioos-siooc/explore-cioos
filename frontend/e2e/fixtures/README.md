# Test fixtures

Every API response and basemap asset the mocked suites replay. One set, read by
both tiers: `e2e/support/mockApi.js` serves them to Playwright, and
`src/test/mockFetch.js` serves the same files to the jsdom unit tests, so the
two can never disagree about what the API returns.

## Layout

| Path | What it holds |
|---|---|
| `api/<endpoint>.json` | the default response for an endpoint |
| `api/<endpoint>__<query>__<hash>.json` | a response that must differ under a particular query |
| `tiles/<kind>/<z>-<x>-<y>.mvt` | recorded vector tiles |
| `basemap/…` | recorded third-party cartography |

`e2e/support/fixtureKey.js` decides which file answers a request: the
query-specific name first, then the bare endpoint. Most endpoints answer the
same thing whatever the query, so only the few whose response has to change
under a filter need a keyed variant. A request with no fixture behind it fails
the test by name — it is never silently answered with nothing.

Tiles are the exception: an unrecorded tile is served `204`, which MapLibre
reads as "nothing here". Recording every tile of every view would be a fixture
set nobody could review.

## Refreshing

```
npm run test:e2e:record -- --base=http://localhost:8098
```

Drives a real browser through the states in `RECORDED_VIEWS`
(`e2e/support/constants.js`) and writes what it sees. Navigation is by URL, not
by clicking: `useUrlSync.js` is the sole writer of the address and every
provider seeds itself back out of it, so a link is a complete description of a
view and the recorder never has to know the chrome.

**Point it at a local stack, not at production.** `https://explore.cioos.ca` is
currently running a much older build (React 17, webpack, MapLibre 2) whose API
does not serve `/obisNodes`, `/erddapServers`, `/timeExtent` or
`/griddapCoverage` — all of which this frontend calls on load. Recording against
it silently produces a fixture set missing those endpoints.

Bring the stack up with `docker compose up -d` from the repository root and run
a harvest first, or the catalogue responses come back empty.

## Provenance

`organizations`, `oceanVariables`, `platforms`, `datasets`, `pointQuery`,
`legend` and the `tiles/` files are recorded responses, truncated to 40 rows so
they stay reviewable in a diff. The rest are hand-written to the shapes in
`web-api/routes/`, because no deployment reachable from here serves them yet;
re-record them against a local stack when one is running.
