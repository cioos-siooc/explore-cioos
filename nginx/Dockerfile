FROM nginx:latest

COPY nginx.conf /etc/nginx/nginx.conf:ro

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:4000/health || exit 1

EXPOSE 4000

CMD ["nginx", "-g", "daemon off;"]
