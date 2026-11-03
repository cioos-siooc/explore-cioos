const axios = require("axios");

// catalogue.hakai.org's ERDDAP answers 403 to axios's own "axios/x.y.z" agent,
// which every upstream call here would otherwise send.
const USER_AGENT = "CIOOS-CDE-WebAPI/1.0 (+https://explore.cioos.ca)";
axios.defaults.headers.common["User-Agent"] = USER_AGENT;

module.exports = { USER_AGENT };
