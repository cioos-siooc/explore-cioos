PROJECT_NAME=$(docker compose config --format json | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")

docker compose down
docker compose rm
docker image rm $(docker images --filter=reference="${PROJECT_NAME}-*" -q)
docker volume rm $(docker volume ls --filter name="${PROJECT_NAME}" -q)

# and then restart the db:
docker compose up -d db
