#!/usr/bin/env sh

curl --request POST   --url http://localhost:4200/api/admin/database/clear   --header 'Content-Type: application/json'   --data ' { "confirm": true } '

