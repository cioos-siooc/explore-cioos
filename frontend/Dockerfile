# Stage 1 - the build process
FROM node:22-alpine AS build-deps
WORKDIR /usr/src/app

ARG API_URL
ARG BASE_URL
ARG SENTRY_TRACES_SAMPLE_RATE
ARG ENVIRONMENT
ARG SENTRY_RELEASE
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV API_URL=$API_URL
ENV BASE_URL=$BASE_URL
ENV SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE
ENV ENVIRONMENT=$ENVIRONMENT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT

# SENTRY_AUTH_TOKEN is deliberately NOT an ARG/ENV. As a build ARG promoted to
# ENV it stayed readable in the image's own metadata — `docker history` and
# `docker inspect` hand it to anyone who can pull the image. It is now a
# BuildKit secret, mounted only for the layer that uploads the source maps and
# never written to a layer. Callers pass it with
#   docker build --secret id=sentry_auth_token,env=SENTRY_AUTH_TOKEN
# or, from compose, `build.secrets` (see docker-compose.production.yaml).

# Install dependencies first so source changes don't bust the npm ci layer
COPY package.json package-lock.json ./
RUN npm ci --quiet

# .dockerignore keeps the host node_modules out of this copy. Without it, the
# laptop's dependency tree landed on top of the one npm ci had just installed
# from the lockfile.
COPY . .

RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build

# Stage 2 - the production environment
# Pinned to match nginx/Dockerfile; this was untagged `nginx`, i.e. latest.
FROM nginx:1.27.4-alpine
COPY --from=build-deps /usr/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

# Serves the built SPA; index.html is the only guaranteed path.
# wget is in the alpine image's busybox, so this adds nothing to the layer.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
