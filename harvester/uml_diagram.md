# CDE Harvester — Architecture UML

---

## Execution Flow

```mermaid
flowchart TD
    CLI["CLI Entry Point\ncde_harvester/__main__.py"]

    subgraph PrefectFlow["Prefect Flow"]
        direction TB
        Main["@flow main()\n__main__.py"]

        subgraph Tasks["Prefect Tasks"]
            ET["@task harvest_erddap()\nerddap_harvester.py"]
            OT["@task harvest_obis()\nobis_harvester.py"]
        end
    end

    subgraph ERDDAPHarvest["ERDDAPHarvester.harvest()"]
        direction TB
        ERDDAP_CLIENT["ERDDAP\nHTTP Client"]
        DS["Dataset\nModel"]
        CC["CDEComplianceChecker"]
        GP["get_profiles()"]
        CKAN_API["get_ckan_records()\nCKAN API"]
    end

    subgraph OBISHarvest["OBISHarvester.harvest()"]
        direction TB
        OBIS_API["OBIS API"]
        GF["ObisGeoFilter\nCanada EEZ"]
    end

    HR["HarvestResult\nprofiles · datasets · variables\nskipped · obis_cells · attempts"]

    subgraph CSVOutput["Output Files"]
        direction LR
        CSV["datasets.csv\nprofiles.csv\nvariables.csv\nskipped.csv"]
        AUDIT["harvest_runs.csv\nattempts.csv"]
    end

    PG[("PostgreSQL\ncde schema")]
    RedisCache[("Redis Cache")]
    Dashboard["Harvest Dashboard\nharvest-dashboard/"]

    CLI --> Main
    Main -->|submit| ET
    Main -->|submit| OT

    ET --> ERDDAPHarvest
    ERDDAP_CLIENT -->|get_dataset| DS
    DS --> CC
    CC -->|passes| GP
    DS --> CKAN_API

    OT --> OBISHarvest
    OBIS_API --> GF

    ERDDAPHarvest --> HR
    OBISHarvest --> HR

    HR --> CSV
    HR --> AUDIT

    CSV -->|db-loader| PG
    PG --> RedisCache
    AUDIT --> Dashboard
```

---

## Class Diagram

```mermaid
classDiagram
    class BaseHarvester {
        <<abstract>>
        +harvest() HarvestResult
    }

    class ERDDAPHarvester {
        +erddap_url : str
        +limit_dataset_ids : list
        +cache_requests : bool
        +run_id : str
        +harvest() HarvestResult
        +get_datasets_to_skip() dict
        -_attempt_urls(dataset, dataset_id) list
    }

    class OBISHarvester {
        +limit_dataset_ids : list
        +folder : str
        +geo_filter : str
        +run_id : str
        +harvest() HarvestResult
    }

    class HarvestResult {
        +profiles : DataFrame
        +datasets : DataFrame
        +variables : DataFrame
        +skipped : DataFrame
        +obis_cells : DataFrame
        +attempts : DataFrame
        +validate()
    }

    class ERDDAP {
        +url : str
        +domain : str
        +cache_requests : bool
        +df_all_datasets : DataFrame
        +get_all_datasets() DataFrame
        +erddap_csv_to_df(url) DataFrame
        +get_dataset(id) Dataset
        +get_logger() Logger
    }

    class Dataset {
        +id : str
        +erddap_url : str
        +cdm_data_type : str
        +globals : dict
        +platform : str
        +eovs : list
        +organizations : list
        +df_variables : DataFrame
        +get_metadata()
        +get_eovs() list
        +get_platform_code() str
        +get_profile_ids() DataFrame
        +get_max_min(vars) DataFrame
        +get_count() DataFrame
        +get_df() DataFrame
    }

    class CDEComplianceChecker {
        +dataset : Dataset
        +failure_reason_code : str
        +passes_all_checks() bool
        +failed_error(msg, code)
    }

    class ObisGeoFilter {
        +mode : str
        +exempt_node_ids : frozenset
        +polygon : Polygon
        +is_exempt(metadata) bool
        +extent_intersects(wkt) bool
        +filter_points(lat, lon) ndarray
    }

    class HarvestDashboard {
        <<service>>
        +queries.py
        +prefect_client.py
        +main.py
    }

    BaseHarvester <|-- ERDDAPHarvester
    BaseHarvester <|-- OBISHarvester
    ERDDAPHarvester ..> HarvestResult : returns
    OBISHarvester ..> HarvestResult : returns
    ERDDAPHarvester --> ERDDAP : uses
    ERDDAP ..> Dataset : creates
    ERDDAPHarvester --> CDEComplianceChecker : validates with
    OBISHarvester --> ObisGeoFilter : filters with
    HarvestResult ..> HarvestDashboard : audit CSVs
```

---

## Key Components

| Class | File | Responsibility |
|-------|------|----------------|
| `BaseHarvester` | `base_harvester.py` | Abstract base + `HarvestResult` dataclass |
| `ERDDAPHarvester` | `erddap_harvester.py` | Per-server ERDDAP harvest (Prefect `@task`) |
| `OBISHarvester` | `obis_harvester.py` | OBIS occurrence harvest (Prefect `@task`) |
| `HarvestResult` | `base_harvester.py` | Typed output container for all harvesters |
| `ERDDAP` | `ERDDAP.py` | HTTP client for ERDDAP REST API |
| `Dataset` | `dataset.py` | Parses metadata, variables, and profile IDs |
| `CDEComplianceChecker` | `CDEComplianceChecker.py` | CF-role, EOV, and depth/altitude validation |
| `ObisGeoFilter` | `obis_geo_filter.py` | Canada EEZ geographic filter for OBIS data |
| `get_ckan_records` | `ckan/create_ckan_erddap_link.py` | Fetches bilingual metadata from CKAN |
| `redisFunctions` | `redisFunctions.py` | Refreshes Redis tile/legend cache |

---

## Main Flow Summary

1. CLI or Prefect triggers `main()` flow in `__main__.py`
2. `harvest_erddap` tasks are submitted concurrently — one per ERDDAP server URL
3. Each `ERDDAPHarvester.harvest()` call:
   - Fetches all dataset IDs from the server (`allDatasets.csv`)
   - Filters by supported CDM data types (TimeSeries, Profile, TimeSeriesProfile)
   - For each dataset: validates compliance, extracts profiles and variables
   - Records every attempt (success / skipped / error) for the audit trail
4. `harvest_obis` task runs concurrently, filtered to Canadian waters via `ObisGeoFilter`
5. All results are merged into `HarvestResult` DataFrames
6. CKAN is queried for bilingual title/organization metadata
7. CSV files are written (`datasets`, `profiles`, `variables`, `skipped`)
8. `db-loader` loads CSVs into PostgreSQL (`cde` schema)
9. Redis cache is refreshed for the web API tile/legend queries
10. Harvest audit CSVs feed the `harvest-dashboard` service
