FROM node:alpine
WORKDIR /usr/src/app
COPY . .
RUN npm ci --quiet
CMD ["node", "./bin/www"]
