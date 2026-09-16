# web-api/

(JS, CommonJS) — Express JSON + vector-tile API, one router per resource, all built on `utils/routePipeline.js`'s validate → filter → query → cache `pipeline()`; Redis-cached (24h server / 60s browser TTL, coupled via `apicache`); bakes source into the image — rebuild, don't restart.
