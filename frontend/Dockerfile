# Stage 1 - the build process
FROM node as build-deps
WORKDIR /usr/src/app
# COPY package-lock.json ./
COPY . .
RUN npm install
RUN npm run build

# Stage 2 - the production environment
FROM nginx
COPY --from=build-deps /usr/src/app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
