const axios = require("axios");

// Upstream admins can tell which deployment and build is calling, and
// catalogue.hakai.org's ERDDAP 403s axios's own "axios/x.y.z" agent. Compose
// sets both; a bare `node` run falls back.
const USER_AGENT = `CIOOS-CDE-WebAPI/${process.env.APP_VERSION || "dev"} (+${
  process.env.APP_URL || "https://github.com/cioos-siooc/explore-cioos"
})`;
axios.defaults.headers.common["User-Agent"] = USER_AGENT;

module.exports = { USER_AGENT };
