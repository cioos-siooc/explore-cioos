FROM nginx:1.27.4

# cron is named explicitly because start.sh runs it — it would otherwise only
# arrive as a recommend of logrotate. --no-install-recommends is what keeps the
# rest out: cron recommends a default MTA, so plain `install -y logrotate` drags
# in exim4 and its dependency tree (libunbound, libgnutls-dane, libtirpc, …).
# That took >14 minutes on a loaded build host and never finished, so the layer
# never cached and every deploy paid it again.
# curl is here only for HEALTHCHECK below — the debian nginx image ships no
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

# Hits the local /healthz stub in nginx.conf, which is answered by nginx
# itself and does NOT proxy to web-api or frontend — an upstream being down
# is a 502 to report, not a reason to declare the proxy dead and have the
# orchestrator restart it.
#
# No USER: start.sh runs cron and logrotate, and nginx binds :4000 and
# writes the /var/log/nginx volume. The master process already drops its
# workers to the `nginx` user (nginx.conf:1).
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/healthz || exit 1

# Start cron, goaccess and nginx
CMD ["/start.sh"]
