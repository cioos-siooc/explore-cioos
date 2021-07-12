
-- after loading CKAN data into the database via the python script
truncate cioos_api.organizations;
insert into cioos_api.organizations (name)
select distinct unnest(parties) from cioos_api.datasets;


-- convert organization list of names into list of pks
with orgs as(
select d.pk,(
select array_remove(array_agg((select case when name=any(parties) then pk end)),null) from cioos_api.organizations) as asdf from cioos_api.datasets d)
update cioos_api.datasets set organization_pks=orgs.asdf
from orgs
where orgs.pk=datasets.pk;



-- TODO this may need a limit 1 now
-- TODO add erddap_url
update cioos_api.datasets d set 
eovs=l.eovs,
parties=l.parties,
ckan_record=l.ckan_record
FROM cioos_api.ckan_data_loader l WHERE
l.dataset_id=d.dataset_id and
l.erddap_url=d.erddap_url;