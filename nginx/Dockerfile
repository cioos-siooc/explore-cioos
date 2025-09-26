FROM nginx:1.27.4

RUN apt-get update && apt-get install -y logrotate

#COPY conf.d/my_proxy.conf /etc/nginx/conf.d/

COPY logrotate.conf /etc/logrotate.d/nginx
RUN chmod 644 /etc/logrotate.d/nginx

COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /etc/nginx/

# Start cron, goaccess and nginx
CMD ["/start.sh"]
