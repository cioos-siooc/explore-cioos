
CREATE OR REPLACE FUNCTION replace_erddap_variables() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE NOTICE '%',NEW;
  DELETE FROM cioos_api.erddap_variables WHERE erddap_url=NEW.erddap_url AND dataset_id=NEW.dataset_id AND "name"=NEW."name";
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_replace_variables on cioos_api.erddap_variables;
CREATE TRIGGER trigger_replace_variables
    BEFORE INSERT ON cioos_api.erddap_variables
    FOR EACH ROW
    EXECUTE PROCEDURE replace_erddap_variables();
    
    