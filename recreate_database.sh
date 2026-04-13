docker compose down
docker compose rm
docker image rm $(docker images --filter=reference='cde-*' -q)
docker volume rm $(docker volume ls --filter name="cde-" -q)

# and then restart the db:
docker compose up -d db
