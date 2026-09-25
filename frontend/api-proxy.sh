#!/bin/sh
# PR previews: dev-v2 sits behind Cloudflare Access, which answers the
# preview's cross-origin API calls with a login redirect. Proxying /api
# same-origin over the server's internal network sidesteps both.
set -eu

[ -n "${API_PROXY_HOST:-}" ] || exit 0

cat > /etc/nginx/api-proxy.conf <<EOF
location ^~ /api/ {
    proxy_pass ${API_PROXY_UPSTREAM:-https://$API_PROXY_HOST}/api/;
    proxy_set_header Host $API_PROXY_HOST;
    proxy_ssl_server_name on;
    proxy_ssl_name $API_PROXY_HOST;
}
EOF
