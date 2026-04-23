FROM node:alpine
WORKDIR /usr/src/app
COPY . .
RUN npm ci --quiet

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/health || exit 1

EXPOSE 5000
CMD ["node", "./bin/www"]
