/*

remove_all_data()

Tables are truncated during data ingestion

*/

CREATE OR REPLACE FUNCTION remove_all_data() RETURNS VOID AS $$
BEGIN

  TRUNCATE cde.profiles;
  TRUNCATE cde.obis_cells;
  TRUNCATE cde.datasets;
  TRUNCATE cde.organizations;
  TRUNCATE cde.points;
  TRUNCATE cde.skipped_datasets;
  TRUNCATE cde.hexes_zoom_0;
  TRUNCATE cde.hexes_zoom_1;

END;
$$ LANGUAGE plpgsql;
