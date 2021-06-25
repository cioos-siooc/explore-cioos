CREATE EXTENSION IF NOT EXISTS postgis;
CREATE schema cioos_api;
CREATE TABLE cioos_api.servers (pk SERIAL PRIMARY KEY, url TEXT UNIQUE);
-- from CSV: ,erddap_url,dataset_id,cdm_data_type,dataset_standard_names

CREATE TABLE cioos_api.datasets (
    pk serial PRIMARY KEY,
    dataset_id text,
    erddap_url text REFERENCES cioos_api.servers(url),
    cdm_data_type text,
    dataset_standard_names text[],
    ckan_record jsonb,
    profile_variable text,
    ckan_url text,
    eovs text[],
    ckan_id text,
    parties text[],
    organization_pks INTEGER[],
    UNIQUE(dataset_id, erddap_url),
);
CREATE TABLE cioos_api.organizations (
    pk SERIAL PRIMARY KEY,
    name text,
    color text
);
-- from csv: server,dataset_id,time_min,time_max,latitude_min,latitude_max,longitude_min,longitude_max
DROP TABLE IF EXISTS cioos_api.profiles;
CREATE TABLE cioos_api.profiles (
    pk serial PRIMARY KEY,
    geom geometry(Point,4326),
    dataset_pk integer REFERENCES cioos_api.datasets(pk),
    server_pk integer REFERENCES cioos_api.servers(pk),
    erddap_url text,
    dataset_id text,
    time_min timestamp with time zone,
    time_max timestamp with time zone,
    latitude_min double precision,
    latitude_max double precision,
    longitude_min double precision,
    longitude_max double precision,
    depth_min double precision,
    depth_max double precision,
    profile_id text
);

DROP TABLE cioos_api.cdm_data_type_override;
CREATE TABLE cioos_api.cdm_data_type_override (
    pk SERIAL PRIMARY KEY,
    erddap_url text,
    dataset_id text,
    cdm_data_type text
);    

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_0);

CREATE INDEX
  ON cioos_api.profiles
  USING GIST (geom_snapped_1);

-- hex bins at 2 zoom levels
alter table cioos_api.profiles add column geom_snapped_0 geometry; 
alter table cioos_api.profiles add column geom_snapped_1 geometry; 

-- create zoom levels
-- zoom 0 : 10000
with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        10000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_0 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk;

-- zoom 1 : 5000
with zoom as (
select p.pk,hexes.geom from ST_HexagonGrid(
        5000,
        st_setsrid(ST_EstimatedExtent('cioos_api','profiles', 'geom'),3857)
    ) AS hexes
    
    inner JOIN cioos_api.profiles p
    ON ST_Intersects(p.geom, hexes.geom)
    )
UPDATE cioos_api.profiles p
SET geom_snapped_1 = z.geom
FROM zoom AS z
WHERE z.pk = p.pk;     

-- Run after scraper runs
UPDATE cioos_api.datasets d
SET cdm_data_type=o.cdm_data_type
FROM cioos_api.cdm_data_type_override o
WHERE o.erddap_url=d.erddap_url AND
o.dataset_id=d.dataset_id;


-- if datasets have no depth assume depth=0
UPDATE cioos_api.profiles SET depth_min=0,depth_max=0 WHERE depth_min is NULL;

-- after loading CKAN data into the database via the python script
insert into cioos_api.organizations (name)
select distinct unnest(parties) from cioos_api.datasets;


-- convert organization list of names into list of pks
with orgs as(
select d.pk,(
select array_remove(array_agg((select case when name=any(parties) then pk end)),null) from cioos_api.organizations) as asdf from cioos_api.datasets d)
update cioos_api.datasets set organization_pks=orgs.asdf
from orgs
where orgs.pk=datasets.pk;


 -- changed ODF_CTD_Profiles to  subSurfaceTemperature, {16}. Added 16,"Bedford Institute of Oceanography" to organizations



--  INSERT INTO "cioos_api"."datasets"("pk","dataset_id","erddap_url","cdm_data_type","dataset_standard_names","ckan_record","profile_variable","ckan_url","is_station","eovs","ckan_id","parties","organization_pks")
-- VALUES
-- (263,E'HakaiKetchikanBoL5min',E'https://catalogue.hakai.org/erddap',E'TimeSeries',NULL,E'{"id": "e1112932-e563-4110-b3f3-687c676d5459", "eov": ["inorganicCarbon", "subSurfaceSalinity", "subSurfaceTemperature"], "url": null, "name": "hakaiketchikanbol5min", "tags": [{"id": "f46235e4-4a54-4114-811f-c0d439ea8bac", "name": "carbone-inorganique", "state": "active", "display_name": "carbone-inorganique", "vocabulary_id": null}, {"id": "d813ba50-6b4a-4d59-bb81-a3ce6d22d1dc", "name": "ckan", "state": "active", "display_name": "ckan", "vocabulary_id": null}, {"id": "2bf6dcdf-323d-441f-b6d9-b7b07c83a585", "name": "inorganiccarbon", "state": "active", "display_name": "inorganiccarbon", "vocabulary_id": null}, {"id": "44580eda-99cb-4332-a6f9-834d42bdd591", "name": "production", "state": "active", "display_name": "production", "vocabulary_id": null}, {"id": "f214fc91-62ab-4717-a4c0-d6471e422484", "name": "salinite-sous-la-surface", "state": "active", "display_name": "salinite-sous-la-surface", "vocabulary_id": null}, {"id": "c14c4a62-8213-4c79-b356-eceb933c35f5", "name": "subsurfacesalinity", "state": "active", "display_name": "subsurfacesalinity", "vocabulary_id": null}, {"id": "f9df1b15-e482-41db-9bbd-d7a5a9b6a4ed", "name": "subsurfacetemperature", "state": "active", "display_name": "subsurfacetemperature", "vocabulary_id": null}, {"id": "0f3f97ac-0d2e-4b10-8ee7-0bb8d5c3cea4", "name": "temperature-sous-la-surface", "state": "active", "display_name": "temperature-sous-la-surface", "vocabulary_id": null}], "type": "dataset", "notes": "{\\"fr\\": \\"L\'analyseur Burke-o-Lator (BoL) pCO2 / TCO2 mesure en continu la pression partielle du dioxyde de carbone (pCO2) et le carbone inorganique total dissous (TCO2) dans un flux d\'eau de mer continu et des \\\\u00e9chantillons discrets. Le BoL est associ\\\\u00e9 \\\\u00e0 un thermosalinographe SBE 45 qui mesure la temp\\\\u00e9rature et la salinit\\\\u00e9 de l\'eau de mer.\\", \\"en\\": \\"The Burke-o-Lator (BoL) pCO2/TCO2 analyzer measures carbon dioxide partial pressure (pCO2) and total dissolved inorganic carbon (TCO2) both continuously from a flow-through seawater stream and from seawater collected in discrete samples. The BoL is paired with a SBE 45 Thermosalinograph to measure seawater temperature and salinity.\\"}", "state": "active", "title": "Burke-o-Lator at Ketchican Shellfish Hatchery in Alaska", "author": null, "extras": [{"key": "access_constraints", "value": "[]"}, {"key": "contact-email", "value": ""}, {"key": "coupled-resource", "value": "[]"}, {"key": "encoding", "value": "utf8"}, {"key": "guid", "value": "HakaiKetchikanBoL5min"}, {"key": "h_job_id", "value": "c09d21e8-4b56-46c0-8593-a6eec18ebf00"}, {"key": "h_object_id", "value": "19b43a60-5a02-463a-911c-1062edeeb8f5"}, {"key": "h_source_id", "value": "79ce3be1-a394-45f6-9fa7-87361de7e7e0"}, {"key": "h_source_title", "value": "CIOOS Pacific"}, {"key": "h_source_url", "value": "https://catalogue.hakai.org/erddap/metadata/iso19115/xml"}, {"key": "licence", "value": ""}, {"key": "metadata-date", "value": "2021-02-02"}, {"key": "responsible-party", "value": "[{\\"name\\": \\"Hakai Institute\\", \\"roles\\": [\\"originator\\"]}, {\\"name\\": \\"UAF Ocean Acidification Research Center\\", \\"roles\\": [\\"originator\\"]}, {\\"name\\": \\"OceansAlaska\\", \\"roles\\": [\\"originator\\"]}]"}, {"key": "spatial-data-service-type", "value": ""}, {"key": "spatial-reference-system", "value": ""}, {"key": "spatial_harvester", "value": "true"}, {"key": "xml_modified_date", "value": "2021-02-03 07:17:00"}], "groups": [], "isopen": true, "private": false, "spatial": "{\\"type\\": \\"Point\\", \\"coordinates\\": [-131.5954, 55.315]}", "keywords": {"en": ["inorganiccarbon", "subsurfacesalinity", "subsurfacetemperature"], "fr": ["carbone-inorganique", "temperature-sous-la-surface", "salinite-sous-la-surface"]}, "num_tags": 8, "progress": "onGoing", "owner_org": "f6f187f7-19f2-4273-a45a-5d9406204873", "resources": [{"id": "e0fd5c94-3c7d-454d-a0f6-499f899e6acd", "url": "https://catalogue.hakai.org/erddap/tabledap/HakaiKetchikanBoL5min.html", "hash": "", "name": "ERDDAP Data Subset Form", "size": null, "state": "active", "format": "ERDDAP", "created": "2021-02-03T20:15:21.329489", "mimetype": null, "position": 0, "url_type": null, "cache_url": null, "package_id": "e1112932-e563-4110-b3f3-687c676d5459", "description": "ERDDAP\'s version of the OPeNDAP .html web page for this dataset. Specify a subset of the dataset and download the data via OPeNDAP or in many different file types.", "revision_id": "4ef52f2e-e0e8-4085-9f33-d981fb2a053a", "last_modified": null, "resource_type": null, "mimetype_inner": null, "datastore_active": false, "cache_last_updated": null, "resource_locator_function": "download", "resource_locator_protocol": "order"}], "license_id": "CC-BY-4.0", "maintainer": null, "license_url": "https://creativecommons.org/licenses/by/4.0/", "revision_id": "4ef52f2e-e0e8-4085-9f33-d981fb2a053a", "author_email": null, "organization": {"id": "f6f187f7-19f2-4273-a45a-5d9406204873", "name": "cioos-pacific", "type": "organization", "state": "active", "title": "", "created": "2019-11-25T14:15:42.257055", "image_url": "", "description": "", "revision_id": "551dae8c-f5e9-4750-a932-be345fa00be1", "approval_status": "approved", "is_organization": true, "title_translated": {"en": "CIOOS-Pacific", "fr": "SIOOC-Pacifique"}, "image_url_translated": {"en": "https://cnckan.cioos.ca/base/images/logos/cioos-pacific_logo_RA_EN.png", "fr": "https://cnckan.cioos.ca/base/images/logos/cioos-pacific_logo_RA_FR.png"}, "description_translated": {"en": "The Canadian Integrated Ocean Observing System (CIOOS) Pacific is the regional hub of the National CIOOS for ocean data aggregation on Canada’s west coast.", "fr": "Le Système intégré d’observation des océans canadien (SIOOC) Pacifique est la plaque tournante régionale du SIOOC national pour l’agrégation des données océaniques sur la côte ouest du Canada."}}, "license_title": "Creative Commons Attribution 4.0", "num_resources": 1, "resource-type": "dataset", "bbox-east-long": "-131.5954", "bbox-north-lat": "55.315", "bbox-south-lat": "55.315", "bbox-west-long": "-131.5954", "creator_user_id": "fec212fe-e7d6-492d-b8c1-ae30ad8b3a7c", "temporal-extent": "{\\"begin\\": \\"\\", \\"end\\": \\"\\"}", "vertical-extent": "{\\"max\\": \\"4\\", \\"min\\": \\"4\\"}", "maintainer_email": null, "metadata_created": "2021-02-18T20:51:41.246625", "notes_translated": {"en": "The Burke-o-Lator (BoL) pCO2/TCO2 analyzer measures carbon dioxide partial pressure (pCO2) and total dissolved inorganic carbon (TCO2) both continuously from a flow-through seawater stream and from seawater collected in discrete samples. The BoL is paired with a SBE 45 Thermosalinograph to measure seawater temperature and salinity.", "fr": "L\'analyseur Burke-o-Lator (BoL) pCO2 / TCO2 mesure en continu la pression partielle du dioxyde de carbone (pCO2) et le carbone inorganique total dissous (TCO2) dans un flux d\'eau de mer continu et des échantillons discrets. Le BoL est associé à un thermosalinographe SBE 45 qui mesure la température et la salinité de l\'eau de mer."}, "title_translated": {"en": "Burke-o-Lator at Ketchican Shellfish Hatchery in Alaska", "fr": "Données du Burke-o-Lator à l\'écloserie de mollusques de Ketchican en Alaska"}, "xml_location_url": "https://catalogue.hakai.org/erddap/metadata/iso19115/xml/HakaiKetchikanBoL5min_iso19115.xml", "metadata-language": "en", "metadata_modified": "2021-02-18T20:51:41.246631", "frequency-of-update": "asNeeded", "dataset-reference-date": "[{\\"type\\": \\"creation\\", \\"value\\": \\"2021-02-02\\"}]", "cited-responsible-party": "[{\\"individual-name\\": \\"\\", \\"contact-info\\": \\"\\", \\"organisation-name\\": \\"Wiley Evans\\", \\"role\\": \\"contributor\\", \\"position-name\\": \\"\\"}, {\\"individual-name\\": \\"\\", \\"contact-info\\": \\"\\", \\"organisation-name\\": \\"UAF Ocean Acidification Research Center\\", \\"role\\": \\"originator\\", \\"position-name\\": \\"\\"}, {\\"individual-name\\": \\"\\", \\"contact-info\\": \\"\\", \\"organisation-name\\": \\"Hakai Institute\\", \\"role\\": \\"originator\\", \\"position-name\\": \\"\\"}, {\\"individual-name\\": \\"\\", \\"contact-info\\": \\"\\", \\"organisation-name\\": \\"OceansAlaska\\", \\"role\\": \\"originator\\", \\"position-name\\": \\"\\"}, {\\"contact-info_online-resource_name\\": \\"\\", \\"position-name\\": \\"\\", \\"contact-info_online-resource_protocol-request\\": \\"\\", \\"contact-info_online-resource_protocol\\": \\"\\", \\"contact-info_online-resource_function\\": \\"\\", \\"contact-info_online-resource_application-profile\\": \\"\\", \\"contact-info_email\\": \\"\\", \\"role\\": \\"originator\\", \\"contact-info_online-resource_url\\": \\"https://www.hakai.org/\\", \\"contact-info_online-resource_description\\": \\"\\", \\"organisation-name\\": \\"\\", \\"individual-name\\": \\"Wiley Evans\\"}]", "relationships_as_object": [], "relationships_as_subject": [], "metadata-point-of-contact": "[{\\"contact-info_online-resource_name\\": \\"\\", \\"position-name\\": \\"\\", \\"contact-info_online-resource_protocol-request\\": \\"\\", \\"contact-info_online-resource_protocol\\": \\"\\", \\"contact-info_online-resource_function\\": \\"\\", \\"contact-info_online-resource_application-profile\\": \\"\\", \\"contact-info_email\\": \\"data@hakai.org\\", \\"role\\": \\"publisher\\", \\"contact-info_online-resource_url\\": \\"https://www.hakai.org/\\", \\"contact-info_online-resource_description\\": \\"\\", \\"organisation-name\\": \\"\\", \\"individual-name\\": \\"Hakai Institiute\\"}]", "responsible_organizations": ["UAF Ocean Acidification Research Center", "Hakai Institute", "OceansAlaska", ""], "unique-resource-identifier-full": "{\\"code\\": \\"HakaiKetchikanBoL5min\\", \\"code-space\\": \\"\\", \\"version\\": \\"\\", \\"authority\\": \\"\\"}"}',E'profile_variable',NULL,NULL,E'{inorganicCarbon,subSurfaceSalinity,subSurfaceTemperature}',NULL,E'{"Hakai Institute","UAF Ocean Acidification Research Center",OceansAlaska}',E'{3,5,8}');


-- "pk","dataset_id","erddap_url","cdm_data_type","dataset_standard_names","ckan_record","profile_variable","ckan_url","is_station","eovs","ckan_id","parties","organization_pks"
-- 262,"HakaiSewardBoL5min","https://catalogue.hakai.org/erddap","TimeSeries",,"{""id"": ""5a6cc404-dccd-4cad-a323-bf26c58c0808"", ""eov"": [""inorganicCarbon"", ""subSurfaceSalinity"", ""subSurfaceTemperature""], ""url"": null, ""name"": ""hakaisewardbol5min"", ""tags"": [{""id"": ""f46235e4-4a54-4114-811f-c0d439ea8bac"", ""name"": ""carbone-inorganique"", ""state"": ""active"", ""display_name"": ""carbone-inorganique"", ""vocabulary_id"": null}, {""id"": ""d813ba50-6b4a-4d59-bb81-a3ce6d22d1dc"", ""name"": ""ckan"", ""state"": ""active"", ""display_name"": ""ckan"", ""vocabulary_id"": null}, {""id"": ""2bf6dcdf-323d-441f-b6d9-b7b07c83a585"", ""name"": ""inorganiccarbon"", ""state"": ""active"", ""display_name"": ""inorganiccarbon"", ""vocabulary_id"": null}, {""id"": ""44580eda-99cb-4332-a6f9-834d42bdd591"", ""name"": ""production"", ""state"": ""active"", ""display_name"": ""production"", ""vocabulary_id"": null}, {""id"": ""f214fc91-62ab-4717-a4c0-d6471e422484"", ""name"": ""salinite-sous-la-surface"", ""state"": ""active"", ""display_name"": ""salinite-sous-la-surface"", ""vocabulary_id"": null}, {""id"": ""c14c4a62-8213-4c79-b356-eceb933c35f5"", ""name"": ""subsurfacesalinity"", ""state"": ""active"", ""display_name"": ""subsurfacesalinity"", ""vocabulary_id"": null}, {""id"": ""f9df1b15-e482-41db-9bbd-d7a5a9b6a4ed"", ""name"": ""subsurfacetemperature"", ""state"": ""active"", ""display_name"": ""subsurfacetemperature"", ""vocabulary_id"": null}, {""id"": ""0f3f97ac-0d2e-4b10-8ee7-0bb8d5c3cea4"", ""name"": ""temperature-sous-la-surface"", ""state"": ""active"", ""display_name"": ""temperature-sous-la-surface"", ""vocabulary_id"": null}], ""type"": ""dataset"", ""notes"": ""{\""fr\"": \""L'analyseur Burke-o-Lator (BoL) pCO2 / TCO2 mesure en continu la pression partielle du dioxyde de carbone (pCO2) et le carbone inorganique total dissous (TCO2) dans un flux d'eau de mer continu et des \\u00e9chantillons discrets. Le BoL est associ\\u00e9 \\u00e0 un thermosalinographe SBE 45 qui mesure la temp\\u00e9rature et la salinit\\u00e9 de l'eau de mer.\"", \""en\"": \""The Burke-o-Lator (BoL) pCO2/TCO2 analyzer measures carbon dioxide partial pressure (pCO2) and total dissolved inorganic carbon (TCO2) both continuously from a flow-through seawater stream and from seawater collected in discrete samples. The BoL is paired with a SBE 45 Thermosalinograph to measure seawater temperature and salinity.\""}"", ""state"": ""active"", ""title"": ""Alutiiq Pride Shellfish Hatchery Burke-o-Lator data"", ""author"": null, ""extras"": [{""key"": ""access_constraints"", ""value"": ""[]""}, {""key"": ""contact-email"", ""value"": """"}, {""key"": ""coupled-resource"", ""value"": ""[]""}, {""key"": ""encoding"", ""value"": ""utf8""}, {""key"": ""guid"", ""value"": ""HakaiSewardBoL5min""}, {""key"": ""h_job_id"", ""value"": ""c09d21e8-4b56-46c0-8593-a6eec18ebf00""}, {""key"": ""h_object_id"", ""value"": ""30278348-9edd-492e-9711-7c2f882a93ac""}, {""key"": ""h_source_id"", ""value"": ""79ce3be1-a394-45f6-9fa7-87361de7e7e0""}, {""key"": ""h_source_title"", ""value"": ""CIOOS Pacific""}, {""key"": ""h_source_url"", ""value"": ""https://catalogue.hakai.org/erddap/metadata/iso19115/xml""}, {""key"": ""licence"", ""value"": """"}, {""key"": ""metadata-date"", ""value"": ""2021-02-02""}, {""key"": ""responsible-party"", ""value"": ""[{\""name\"": \""Hakai Institute\"", \""roles\"": [\""originator\""]}, {\""name\"": \""Alutiiq Pride Shellfish Hatchery\"", \""roles\"": [\""originator\""]}, {\""name\"": \""Oregon State University\"", \""roles\"": [\""originator\""]}]""}, {""key"": ""spatial-data-service-type"", ""value"": """"}, {""key"": ""spatial-reference-system"", ""value"": """"}, {""key"": ""spatial_harvester"", ""value"": ""true""}, {""key"": ""xml_modified_date"", ""value"": ""2021-02-03 07:17:00""}], ""groups"": [], ""isopen"": true, ""private"": false, ""spatial"": ""{\""type\"": \""Point\"", \""coordinates\"": [-149.4428, 60.0992]}"", ""keywords"": {""en"": [""inorganiccarbon"", ""subsurfacesalinity"", ""subsurfacetemperature""], ""fr"": [""carbone-inorganique"", ""temperature-sous-la-surface"", ""salinite-sous-la-surface""]}, ""num_tags"": 8, ""progress"": ""onGoing"", ""owner_org"": ""f6f187f7-19f2-4273-a45a-5d9406204873"", ""resources"": [{""id"": ""1ca19188-81aa-42a6-9187-d4525db4629b"", ""url"": ""https://catalogue.hakai.org/erddap/tabledap/HakaiSewardBoL5min.html"", ""hash"": """", ""name"": ""ERDDAP Data Subset Form"", ""size"": null, ""state"": ""active"", ""format"": ""ERDDAP"", ""created"": ""2021-02-03T20:15:22.203920"", ""mimetype"": null, ""position"": 0, ""url_type"": null, ""cache_url"": null, ""package_id"": ""5a6cc404-dccd-4cad-a323-bf26c58c0808"", ""description"": ""ERDDAP's version of the OPeNDAP .html web page for this dataset. Specify a subset of the dataset and download the data via OPeNDAP or in many different file types."", ""revision_id"": ""21a6775b-b5c8-4711-bb36-1ca9ea47cff9"", ""last_modified"": null, ""resource_type"": null, ""mimetype_inner"": null, ""datastore_active"": false, ""cache_last_updated"": null, ""resource_locator_function"": ""download"", ""resource_locator_protocol"": ""order""}], ""license_id"": ""CC-BY-4.0"", ""maintainer"": null, ""license_url"": ""https://creativecommons.org/licenses/by/4.0/"", ""revision_id"": ""21a6775b-b5c8-4711-bb36-1ca9ea47cff9"", ""author_email"": null, ""organization"": {""id"": ""f6f187f7-19f2-4273-a45a-5d9406204873"", ""name"": ""cioos-pacific"", ""type"": ""organization"", ""state"": ""active"", ""title"": """", ""created"": ""2019-11-25T14:15:42.257055"", ""image_url"": """", ""description"": """", ""revision_id"": ""551dae8c-f5e9-4750-a932-be345fa00be1"", ""approval_status"": ""approved"", ""is_organization"": true, ""title_translated"": {""en"": ""CIOOS-Pacific"", ""fr"": ""SIOOC-Pacifique""}, ""image_url_translated"": {""en"": ""https://cnckan.cioos.ca/base/images/logos/cioos-pacific_logo_RA_EN.png"", ""fr"": ""https://cnckan.cioos.ca/base/images/logos/cioos-pacific_logo_RA_FR.png""}, ""description_translated"": {""en"": ""The Canadian Integrated Ocean Observing System (CIOOS) Pacific is the regional hub of the National CIOOS for ocean data aggregation on Canada’s west coast."", ""fr"": ""Le Système intégré d’observation des océans canadien (SIOOC) Pacifique est la plaque tournante régionale du SIOOC national pour l’agrégation des données océaniques sur la côte ouest du Canada.""}}, ""license_title"": ""Creative Commons Attribution 4.0"", ""num_resources"": 1, ""resource-type"": ""dataset"", ""bbox-east-long"": ""-149.4428"", ""bbox-north-lat"": ""60.0992"", ""bbox-south-lat"": ""60.0992"", ""bbox-west-long"": ""-149.4428"", ""creator_user_id"": ""fec212fe-e7d6-492d-b8c1-ae30ad8b3a7c"", ""temporal-extent"": ""{\""begin\"": \""\"", \""end\"": \""\""}"", ""vertical-extent"": ""{\""max\"": \""70\"", \""min\"": \""70\""}"", ""maintainer_email"": null, ""metadata_created"": ""2021-02-18T19:37:10.861728"", ""notes_translated"": {""en"": ""The Burke-o-Lator (BoL) pCO2/TCO2 analyzer measures carbon dioxide partial pressure (pCO2) and total dissolved inorganic carbon (TCO2) both continuously from a flow-through seawater stream and from seawater collected in discrete samples. The BoL is paired with a SBE 45 Thermosalinograph to measure seawater temperature and salinity."", ""fr"": ""L'analyseur Burke-o-Lator (BoL) pCO2 / TCO2 mesure en continu la pression partielle du dioxyde de carbone (pCO2) et le carbone inorganique total dissous (TCO2) dans un flux d'eau de mer continu et des échantillons discrets. Le BoL est associé à un thermosalinographe SBE 45 qui mesure la température et la salinité de l'eau de mer.""}, ""title_translated"": {""en"": ""Alutiiq Pride Shellfish Hatchery Burke-o-Lator data"", ""fr"": ""Données Burke-o-Lator de l'écloserie de mollusque d'Alutiiq Pride en Alaska""}, ""xml_location_url"": ""https://catalogue.hakai.org/erddap/metadata/iso19115/xml/HakaiSewardBoL5min_iso19115.xml"", ""metadata-language"": ""en"", ""metadata_modified"": ""2021-02-18T19:37:10.861734"", ""frequency-of-update"": ""asNeeded"", ""dataset-reference-date"": ""[{\""type\"": \""creation\"", \""value\"": \""2021-02-02\""}]"", ""cited-responsible-party"": ""[{\""individual-name\"": \""\"", \""contact-info\"": \""\"", \""organisation-name\"": \""Wiley Evans\"", \""role\"": \""contributor\"", \""position-name\"": \""\""}, {\""individual-name\"": \""\"", \""contact-info\"": \""\"", \""organisation-name\"": \""Oregon State University\"", \""role\"": \""originator\"", \""position-name\"": \""\""}, {\""individual-name\"": \""\"", \""contact-info\"": \""\"", \""organisation-name\"": \""Alutiiq Pride Shellfish Hatchery\"", \""role\"": \""originator\"", \""position-name\"": \""\""}, {\""individual-name\"": \""\"", \""contact-info\"": \""\"", \""organisation-name\"": \""Hakai Institute\"", \""role\"": \""originator\"", \""position-name\"": \""\""}, {\""contact-info_online-resource_name\"": \""\"", \""position-name\"": \""\"", \""contact-info_online-resource_protocol-request\"": \""\"", \""contact-info_online-resource_protocol\"": \""\"", \""contact-info_online-resource_function\"": \""\"", \""contact-info_online-resource_application-profile\"": \""\"", \""contact-info_email\"": \""\"", \""role\"": \""originator\"", \""contact-info_online-resource_url\"": \""https://www.hakai.org/\"", \""contact-info_online-resource_description\"": \""\"", \""organisation-name\"": \""\"", \""individual-name\"": \""Wiley Evans\""}]"", ""relationships_as_object"": [], ""relationships_as_subject"": [], ""metadata-point-of-contact"": ""[{\""contact-info_online-resource_name\"": \""\"", \""position-name\"": \""\"", \""contact-info_online-resource_protocol-request\"": \""\"", \""contact-info_online-resource_protocol\"": \""\"", \""contact-info_online-resource_function\"": \""\"", \""contact-info_online-resource_application-profile\"": \""\"", \""contact-info_email\"": \""data@hakai.org\"", \""role\"": \""publisher\"", \""contact-info_online-resource_url\"": \""https://www.hakai.org/\"", \""contact-info_online-resource_description\"": \""\"", \""organisation-name\"": \""\"", \""individual-name\"": \""Hakai Institiute\""}]"", ""responsible_organizations"": [""Oregon State University"", ""Alutiiq Pride Shellfish Hatchery"", ""Hakai Institute"", """"], ""unique-resource-identifier-full"": ""{\""code\"": \""HakaiSewardBoL5min\"", \""code-space\"": \""\"", \""version\"": \""\"", \""authority\"": \""\""}""}","profile_variable",,,"{inorganicCarbon,subSurfaceSalinity,subSurfaceTemperature}",,"{""Hakai Institute"",""Alutiiq Pride Shellfish Hatchery"",""Oregon State University""}","{3,6,9}"
