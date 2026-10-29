# Stage 1 - the build process
FROM node:25-alpine AS build-deps
WORKDIR /usr/src/app

ARG API_URL
ARG BASE_URL
ARG SENTRY_DSN
ARG SENTRY_TRACES_SAMPLE_RATE
ARG ENVIRONMENT
ARG SENTRY_RELEASE
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV API_URL=$API_URL
ENV BASE_URL=$BASE_URL
ENV SENTRY_DSN=$SENTRY_DSN
ENV SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE
ENV ENVIRONMENT=$ENVIRONMENT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT

# SENTRY_DSN is a plain ARG on purpose: vite bakes it into the public bundle.
# SENTRY_AUTH_TOKEN must NOT be an ARG/ENV (docker history/inspect would leak
# it); it is a BuildKit secret:
#   docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN
# or `build.secrets` in compose (see docker-compose.production.yaml).

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --quiet

# Dockerfile.dockerignore keeps the host node_modules out of this copy.
COPY frontend/ .

# Why the build context is the repo root; vite.config.mjs resolves it as
# ../docs/harvesting.
COPY docs/harvesting /usr/src/docs/harvesting

# Node's default heap cap (~2 GB) is below the build's ~3.3 GB peak.
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    NODE_OPTIONS=--max-old-space-size=4096 \
    npm run build

# Stage 2 - the production environment
# Pinned to match nginx/Dockerfile.
FROM nginx:1.31.8-alpine
COPY --from=build-deps /usr/src/app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 frontend/api-proxy.sh /docker-entrypoint.d/40-api-proxy.sh
EXPOSE 80

# wget comes with busybox, so this adds nothing to the layer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
