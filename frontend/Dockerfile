# Stage 1 - the build process
FROM node:22-alpine AS build-deps
WORKDIR /usr/src/app

ARG API_URL
ARG BASE_URL
ARG SENTRY_TRACES_SAMPLE_RATE
ENV API_URL=$API_URL
ENV BASE_URL=$BASE_URL
ENV SENTRY_TRACES_SAMPLE_RATE=$SENTRY_TRACES_SAMPLE_RATE

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
