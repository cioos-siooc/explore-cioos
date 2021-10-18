const redis = require("redis");
const client = redis.createClient({ return_buffers: true });
module.exports = client;
