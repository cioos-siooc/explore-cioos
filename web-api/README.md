# CEDA Web API

This API created with express-generator.

- This is the API that the front end and downloader interact with
- It is also a vector tile server

## Install

- Copy .env.sample to .env and set it up for your database
- `npm install`
- `npm start`
- See if it worked: `curl localhost:3000`
- See if tile server works: `curl localhost:3000/tiles/1/3/2.mvt`
