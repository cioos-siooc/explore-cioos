# Stage 1 - the build process
FROM node:16 as build-deps
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
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
