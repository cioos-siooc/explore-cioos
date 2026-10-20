# harvester/

(Python 3.13) — ERDDAP/OBIS/CKAN harvest as Prefect flows on `prefect_worker` (process pool, not cron), one flow run per source, fanned out by `cde-harvest-all`; `cde_harvester/core/schemas.py` is the Pandera contract with `database/1_schema.sql`; `dataset_types/` has one handler per `cdm_data_type`; OBIS datasets are auto-discovered (`obis_discovery`), not the stale root `Obis_Datasets.json`; `harvest_config.yaml` is never baked into the image.

## Objective

Answer **what/when/where** per dataset and subset, without overloading the source server or the local one — favor cheap metadata queries and efficient runs over pulling full record data.

## Harvest docs

Three linked docs in `docs/harvesting/`, bundled by the frontend and shown at `/harvest/docs/<name>`: `workflow.md` (orchestration, run outcomes, freshness, CKAN, loading), `erddap.md` (per `cdm_data_type`) and `obis.md` (discovery, cells, cache). Any change to harvester or loader behavior (queries, fallbacks, thresholds, skip/compliance rules, reason codes, supported types, pruning) must update the affected doc in the same change.

## `HARVEST_VERSION`

ERDDAP datasets whose Croissant hash is unchanged are skipped, so their stored rows only change when `HARVEST_VERSION` (`cde_harvester/sources/erddap/client.py`) is bumped. Bump it in the same change whenever existing ERDDAP datasets would be harvested differently: queries, parsing, derived values, thresholds, compliance/skip rules, `dataset_types/` handlers, or a `database/` schema change to columns the harvest fills. Don't bump it for refactors, logging, OBIS-only changes, or loader SQL that recomputes from rows already stored. For a one-off re-harvest without a code change, run the flow with `force=true` instead.
