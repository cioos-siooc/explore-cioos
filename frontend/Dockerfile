# Stage 1 - the build process
FROM node:16 AS build-deps
WORKDIR /usr/src/app

ARG API_URL
ARG BASE_URL
ENV API_URL $API_URL
ENV BASE_URL $BASE_URL

COPY . .
RUN npm ci --quiet
RUN npm run build

# Stage 2 - the production environment
FROM nginx
COPY --from=build-deps /usr/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
