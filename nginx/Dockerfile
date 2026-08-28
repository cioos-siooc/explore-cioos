FROM nginx:1.27.4

# cron is named explicitly because start.sh runs it — it would otherwise only
# arrive as a recommend of logrotate. --no-install-recommends is what keeps the
# rest out: cron recommends a default MTA, so plain `install -y logrotate` drags
# in exim4 and its dependency tree (libunbound, libgnutls-dane, libtirpc, …).
# That took >14 minutes on a loaded build host and never finished, so the layer
# never cached and every deploy paid it again.
RUN apt-get update \
    && apt-get install -y --no-install-recommends logrotate cron \
    && rm -rf /var/lib/apt/lists/*

#COPY conf.d/my_proxy.conf /etc/nginx/conf.d/

COPY logrotate.conf /etc/logrotate.conf
RUN chown root:root /etc/logrotate.conf
RUN chmod 0644 /etc/logrotate.conf

COPY nginx.conf /etc/nginx/nginx.conf

COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /etc/nginx/

# Start cron, goaccess and nginx
CMD ["/start.sh"]
