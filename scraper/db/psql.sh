# psql hakai -h db.hakai.org -U user
# \copy cioos_api.profiles (erddap_url,dataset_id,time_min,time_max,latitude_min,latitude_max,longitude_min) FROM 'profiles.csv' WITH CSV HEADER
# \copy cioos_api.datasets (erddap_url,dataset_id,cdm_data_type,dataset_standard_names) FROM 'datasets.csv' WITH CSV HEADER

# HHh0f2jj

psql <<EOF
COPY cioos_api.profiles(erddap_url,dataset_id, time_min,time_max,time_max,latitude_min,latitude_max,longitude_min,longitude_max)
FROM 'profiles.csv'
DELIMITER ','
CSV HEADER;

COPY cioos_api.datasets(erddap_url,dataset_id, cdm_data_type,dataset_standard_names)
FROM 'profiles.csv'
DELIMITER ','
CSV HEADER;
EOF
