/* 
 
 set_constraints()
 drop_constraints()

 Constraints on datasets,profiles tables are dropped temporarily when data is being ingested

 */

 
CREATE OR REPLACE FUNCTION set_constraints() RETURNS VOID AS $$
BEGIN

ALTER TABLE cde.datasets 
    ALTER COLUMN dataset_id SET NOT NULL,
    ALTER COLUMN erddap_url SET NOT NULL,
    ALTER COLUMN cdm_data_type SET NOT NULL,
    ALTER COLUMN title SET NOT NULL,
    ALTER COLUMN cdm_data_type SET NOT NULL,
    ALTER COLUMN organizations SET NOT NULL,
    ALTER COLUMN eovs SET NOT NULL,
    ALTER COLUMN n_profiles SET NOT NULL,
    ALTER COLUMN platform SET NOT NULL,
    ALTER COLUMN organization_pks SET NOT NULL;

ALTER TABLE cde.profiles 
    ALTER COLUMN geom SET NOT NULL,
    ALTER COLUMN dataset_pk SET NOT NULL,
    ALTER COLUMN erddap_url SET NOT NULL,
    ALTER COLUMN dataset_id SET NOT NULL,
    ALTER COLUMN time_min SET NOT NULL,
    ALTER COLUMN time_max SET NOT NULL,
    ALTER COLUMN latitude SET NOT NULL,
    ALTER COLUMN longitude SET NOT NULL,
    ALTER COLUMN depth_min SET NOT NULL,
    ALTER COLUMN depth_max SET NOT NULL,
    ALTER COLUMN n_records SET NOT NULL,
    ALTER COLUMN hex_zoom_0 SET NOT NULL,
    ALTER COLUMN hex_zoom_1 SET NOT NULL,
    ALTER COLUMN point_pk SET NOT NULL,
    ALTER COLUMN records_per_day SET NOT NULL,
    ADD CONSTRAINT hexes_zoom_0_foreign FOREIGN KEY (hex_0_pk) REFERENCES cde.hexes_zoom_0 (pk),
    ADD CONSTRAINT hexes_zoom_1_foreign FOREIGN KEY (hex_1_pk) REFERENCES cde.hexes_zoom_1 (pk);

ALTER TABLE cde.points
    ADD CONSTRAINT hexes_zoom_0_points_foreign FOREIGN KEY (hex_0_pk) REFERENCES cde.hexes_zoom_0 (pk),
    ADD CONSTRAINT hexes_zoom_1_points_foreign FOREIGN KEY (hex_1_pk) REFERENCES cde.hexes_zoom_1 (pk);


END;

$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION drop_constraints() RETURNS VOID AS $$
BEGIN

ALTER TABLE cde.datasets 
    ALTER COLUMN dataset_id DROP NOT NULL,
    ALTER COLUMN erddap_url DROP NOT NULL,
    ALTER COLUMN cdm_data_type DROP NOT NULL,
    ALTER COLUMN title DROP NOT NULL,
    ALTER COLUMN cdm_data_type DROP NOT NULL,
    ALTER COLUMN organizations DROP NOT NULL,
    ALTER COLUMN eovs DROP NOT NULL,
    ALTER COLUMN n_profiles DROP NOT NULL,
    ALTER COLUMN platform DROP NOT NULL,
    ALTER COLUMN organization_pks DROP NOT NULL;

ALTER TABLE cde.profiles 
    ALTER COLUMN geom DROP NOT NULL,
    ALTER COLUMN dataset_pk DROP NOT NULL,
    ALTER COLUMN erddap_url DROP NOT NULL,
    ALTER COLUMN dataset_id DROP NOT NULL,
    ALTER COLUMN time_min DROP NOT NULL,
    ALTER COLUMN time_max DROP NOT NULL,
    ALTER COLUMN latitude DROP NOT NULL,
    ALTER COLUMN longitude DROP NOT NULL,
    ALTER COLUMN depth_min DROP NOT NULL,
    ALTER COLUMN depth_max DROP NOT NULL,
    ALTER COLUMN n_records DROP NOT NULL,
    ALTER COLUMN hex_zoom_0 DROP NOT NULL,
    ALTER COLUMN hex_zoom_1 DROP NOT NULL,
    ALTER COLUMN point_pk DROP NOT NULL,
    ALTER COLUMN records_per_day DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS hexes_zoom_0_foreign,
    DROP CONSTRAINT IF EXISTS hexes_zoom_1_foreign;    

ALTER TABLE cde.points
    DROP CONSTRAINT IF EXISTS hexes_zoom_0_points_foreign,
    DROP CONSTRAINT IF EXISTS hexes_zoom_1_points_foreign;    

END;

$$ LANGUAGE plpgsql;

