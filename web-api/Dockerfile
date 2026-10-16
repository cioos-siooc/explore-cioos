# 24 matches frontend/Dockerfile and the CI node-version.
FROM node:24-alpine

WORKDIR /usr/src/app

# Unset, express defaults to "development" and app.js's error handler would
# return stack traces.
ENV NODE_ENV=production

# Lockfile first so a source-only change reuses the install layer.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --quiet

COPY --chown=node:node . .

USER node

EXPOSE 5000

# Liveness only, deliberately not a DB probe: nginx gates on this, so a
# database blip would take the whole site down.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||5000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "./bin/www"]
