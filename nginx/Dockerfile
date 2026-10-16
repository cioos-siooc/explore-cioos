FROM nginx:1.30.5

# --no-install-recommends keeps cron's default MTA (exim4 and its tree) out,
# so cron must be named explicitly for start.sh. curl is only for
# healthcheck.sh; the debian nginx image ships no HTTP client.
RUN apt-get update \
    && apt-get install -y --no-install-recommends logrotate cron curl \
    && rm -rf /var/lib/apt/lists/*


COPY logrotate.conf /etc/logrotate.conf
RUN chown root:root /etc/logrotate.conf
RUN chmod 0644 /etc/logrotate.conf

COPY nginx.conf /etc/nginx/nginx.conf

COPY start.sh /start.sh
RUN chmod +x /start.sh

WORKDIR /etc/nginx/

COPY healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh

# End to end (nginx, SPA, API, the scheduler's heartbeat): deep on purpose,
# because nothing depends_on nginx; web-api's own check stays shallow since
# nginx gates on it.
#
# No USER: start.sh runs cron and logrotate as root; the nginx master already
# drops its workers to the `nginx` user.
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
  CMD /healthcheck.sh

CMD ["/start.sh"]
