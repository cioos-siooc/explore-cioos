#!/bin/bash

# Start the cron service
service cron start

# Start the logrotate service
logrotate /etc/logrotate.d/nginx
 
nginx -c /etc/nginx/nginx.conf -g 'daemon off;'
