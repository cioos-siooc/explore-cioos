docker-compose down
docker-compose rm
docker image rm $(docker images --filter=reference='cde_*')
docker volume rm $(docker volume ls --filter name="cde_")

# and then restart the db:
docker-compose up -d db
