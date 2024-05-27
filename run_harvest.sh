cd ~/cde
rm -rf harvester_cache
rm -rf ckan_harvester_cache
~/miniconda3/envs/cde/bin/python -m cde_harvester -f harvest_config.yaml && \
~/miniconda3/envs/cde/bin/python -m cde_db_loader && \
ssh cioos@pac-prod2.cioos.org bash -c "cd ~/cde;sh /home/cioos/cde/post_harvest.sh"
