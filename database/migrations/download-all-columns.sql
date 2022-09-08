DROP VIEW cde.dataset_to_eov;
DROP TABLE IF EXISTS cde.erddap_variables;
DROP TABLE IF EXISTS cde.eov_to_standard_name;

ALTER TABLE cde.datasets ADD COLUMN num_columns integer;