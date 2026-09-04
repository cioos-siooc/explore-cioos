#!/bin/bash

# Start the cron service
service cron start

# Ensure logrotate config has correct permissions
chown root:root /etc/logrotate.conf
chmod 0644 /etc/logrotate.conf
 
nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
