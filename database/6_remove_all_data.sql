/* 

remove_all_data()

Tables are truncated during data ingestion

*/

CREATE OR REPLACE FUNCTION remove_all_data() RETURNS VOID AS $$
BEGIN

DELETE FROM cde.profiles;
DELETE FROM cde.datasets;
DELETE FROM cde.organizations;
DELETE FROM cde.points;
DELETE FROM cde.skipped_datasets;
DELETE FROM cde.hexes_zoom_0;
DELETE FROM cde.hexes_zoom_1;

END;
$$ LANGUAGE plpgsql;



