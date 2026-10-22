#!/bin/bash

service cron start

# The base image links these to /dev/stdout and /dev/stderr, and a fresh
# nginx_logs volume is seeded with those links; the harvester's cache warm
# and logrotate need real files.
find /var/log/nginx -maxdepth 1 -type l -name '*.log' -delete

chown root:root /etc/logrotate.conf
chmod 0644 /etc/logrotate.conf

nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
