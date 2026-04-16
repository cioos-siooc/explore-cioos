/*

remove_all_data()

Tables are truncated during data ingestion

*/

CREATE OR REPLACE FUNCTION remove_all_data() RETURNS VOID AS $$
BEGIN

  TRUNCATE cde.profiles, cde.obis_cells, cde.datasets, cde.organizations,
           cde.points, cde.skipped_datasets, cde.hexes_zoom_0, cde.hexes_zoom_1;

END;
$$ LANGUAGE plpgsql;
