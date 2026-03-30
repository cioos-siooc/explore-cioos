FROM nginx:1.27.4

RUN apt-get update && apt-get install -y logrotate

#COPY conf.d/my_proxy.conf /etc/nginx/conf.d/

COPY logrotate.conf /etc/logrotate.conf
RUN chown root:root /etc/logrotate.conf 
RUN chmod 0644 /etc/logrotate.conf

COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /etc/nginx/

# Start cron, goaccess and nginx
CMD ["/start.sh"]
