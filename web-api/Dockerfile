# Pinned. This read `node:alpine` — no version at all — so the runtime was
# whatever `latest` happened to be on the day of the build, silently drifting
# across majors. 22 matches frontend/Dockerfile and the CI node-version.
FROM node:22-alpine

WORKDIR /usr/src/app

# express derives app.get("env") from this, and the JSON error handler in
# app.js withholds the stack trace unless it says development. Unset, express
# defaults to "development" — so the container was answering 500s with a
# full stack trace in the response body.
ENV NODE_ENV=production

# Dependencies first, from the lockfile only, so a source-only change reuses
# this layer. This used to be a single `COPY . .` before `npm ci`, which meant
# the whole tree (including the host's 104 MB node_modules, now excluded by
# .dockerignore) invalidated the install layer on every edit.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --quiet

COPY --chown=node:node . .

# The node images ship an unprivileged `node` user; nothing here writes outside
# the image, so there is no volume whose ownership this could break.
USER node

EXPOSE 5000

# bin/www listens on PORT (default 5000). Liveness only — deliberately NOT a DB
# probe: nginx gates on this service being healthy, so tying it to Postgres
# would take the whole site down for a database blip rather than just the
# routes that need data.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "./bin/www"]
