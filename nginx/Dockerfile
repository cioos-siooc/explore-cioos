FROM nginx:1.27.4

# cron is named explicitly because start.sh runs it — it would otherwise only
# arrive as a recommend of logrotate. --no-install-recommends is what keeps the
# rest out: cron recommends a default MTA, so plain `install -y logrotate` drags
# in exim4 and its dependency tree (libunbound, libgnutls-dane, libtirpc, …).
# That took >14 minutes on a loaded build host and never finished, so the layer
# never cached and every deploy paid it again.
# curl is here only for healthcheck.sh below — the debian nginx image ships no
# HTTP client at all, and this service is what the whole site is reached
# through, so it is the one that most needs a readiness signal.
RUN apt-get update \
    && apt-get install -y --no-install-recommends logrotate cron curl \
    && rm -rf /var/lib/apt/lists/*

#COPY conf.d/my_proxy.conf /etc/nginx/conf.d/

COPY logrotate.conf /etc/logrotate.conf
RUN chown root:root /etc/logrotate.conf
RUN chmod 0644 /etc/logrotate.conf

COPY nginx.conf /etc/nginx/nginx.conf

COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /etc/nginx/

COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh

# End to end: nginx itself, the SPA and API through the proxy (the API's
# /health/ready covers Postgres and the download queue), and the scheduler's
# heartbeat in the downloads volume. Deep on purpose, because nothing
# depends_on nginx; web-api's own check stays shallow since nginx gates on it.
# The grace covers a fresh deploy's scheduler writing its first heartbeat.
#
# No USER: start.sh runs cron and logrotate, and nginx binds :4000 and
# writes the /var/log/nginx volume. The master process already drops its
# workers to the `nginx` user (nginx.conf:1).
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD /healthcheck.sh

# Start cron, goaccess and nginx
CMD ["/start.sh"]
