CREATE OR REPLACE FUNCTION remove_all_data() RETURNS VOID AS $$
BEGIN

DELETE FROM cioos_api.erddap_variables;
DELETE FROM cioos_api.profiles;
DELETE FROM cioos_api.datasets;
DELETE FROM cioos_api.organizations;
DELETE FROM cioos_api.points;
DELETE FROM cioos_api.eov_to_standard_name;
DELETE FROM cioos_api.skipped_datasets;

-- These ones cant be recreated:
-- DELETE FROM cioos_api.download_jobs;

END;
$$ LANGUAGE plpgsql;



