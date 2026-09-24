# harvester/

(Python 3.10) — ERDDAP/OBIS/CKAN harvest as Prefect flows on `prefect_worker` (process pool, not cron), one flow run per source, fanned out by `cde-harvest-all`; `cde_harvester/core/schemas.py` is the Pandera contract with `database/1_schema.sql`; `dataset_types/` has one handler per `cdm_data_type`; OBIS datasets are auto-discovered (`obis_discovery`), not the stale root `Obis_Datasets.json`; `harvest_config.yaml` is never baked into the image.

## Objective

Answer **what/when/where** per dataset and subset, without overloading the source server or the local one — favor cheap metadata queries and efficient runs over pulling full record data.
