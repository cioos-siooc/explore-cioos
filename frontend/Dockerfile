# Stage 1 - the build process
FROM node:22-alpine AS build-deps
WORKDIR /usr/src/app

ARG API_URL
ARG BASE_URL
ARG SENTRY_TRACES_SAMPLE_RATE
ARG ENVIRONMENT
ARG SENTRY_RELEASE
ARG SENTRY_AUTH_TOKEN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ENV API_URL=$API_URL
ENV BASE_URL=$BASE_URL
ENV SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE
ENV ENVIRONMENT=$ENVIRONMENT
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT

# Install dependencies first so source changes don't bust the npm ci layer
COPY package.json package-lock.json ./
RUN npm ci --quiet

COPY . .
RUN npm run build

# Stage 2 - the production environment
FROM nginx
COPY --from=build-deps /usr/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
