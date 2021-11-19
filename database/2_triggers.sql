
---- Triggers

-- makes upsert easier, since Pandas to_sql doesn't support upsert
CREATE OR REPLACE FUNCTION replace_datasets() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE NOTICE '%',NEW;
  DELETE FROM cioos_api.datasets_data_loader WHERE erddap_url=NEW.erddap_url AND dataset_id=NEW.dataset_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_replace_datasets on cioos_api.datasets_data_loader;
CREATE TRIGGER trigger_replace_datasets
    BEFORE INSERT ON cioos_api.datasets_data_loader
    FOR EACH ROW
    EXECUTE PROCEDURE replace_datasets();


CREATE OR REPLACE FUNCTION replace_profiles() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE NOTICE '%',NEW;
  DELETE FROM cioos_api.profiles_data_loader WHERE
    erddap_url=NEW.erddap_url AND 
    dataset_id=NEW.dataset_id AND 
    (profile_id=NEW.profile_id OR profile_id IS NULL AND NEW.profile_id IS NULL) AND
    (timeseries_id=NEW.timeseries_id OR timeseries_id IS NULL AND NEW.timeseries_id IS NULL);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_replace_profiles on cioos_api.profiles_data_loader;
CREATE TRIGGER trigger_replace_profiles
    BEFORE INSERT ON cioos_api.profiles_data_loader
    FOR EACH ROW
    EXECUTE PROCEDURE replace_profiles();


CREATE OR REPLACE FUNCTION replace_erddap_variables() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE NOTICE '%',NEW;
  DELETE FROM cioos_api.erddap_variables WHERE erddap_url=NEW.erddap_url AND dataset_id=NEW.dataset_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_replace_variables on cioos_api.erddap_variables;
CREATE TRIGGER trigger_replace_variables
    BEFORE INSERT ON cioos_api.erddap_variables
    FOR EACH ROW
    EXECUTE PROCEDURE replace_erddap_variables();
    
    