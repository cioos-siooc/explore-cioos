#!/bin/bash

service cron start

chown root:root /etc/logrotate.conf
chmod 0644 /etc/logrotate.conf

nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
