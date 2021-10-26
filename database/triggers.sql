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
  DELETE FROM cioos_api.profiles_data_loader WHERE erddap_url=NEW.erddap_url AND dataset_id=NEW.dataset_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_replace_profiles on cioos_api.profiles_data_loader;
CREATE TRIGGER trigger_replace_profiles
    BEFORE INSERT ON cioos_api.profiles_data_loader
    FOR EACH ROW
    EXECUTE PROCEDURE replace_profiles();
    
    