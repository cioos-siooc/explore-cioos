import os

# Upstream admins can tell which deployment and build is calling; some servers
# 403 the libraries' default agents. Compose sets both; bare runs fall back.
USER_AGENT = (
    f"CIOOS-CDE-Harvester/{os.environ.get('APP_VERSION') or 'dev'} "
    f"(+{os.environ.get('APP_URL') or 'https://github.com/cioos-siooc/explore-cioos'})"
)
HEADERS = {"User-Agent": USER_AGENT}
