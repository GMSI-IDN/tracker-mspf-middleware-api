const NodeCache = require('node-cache');
const config = require('../config');

const cache = new NodeCache({
  stdTTL: config.cache.ttl,
  checkperiod: 60,
});

module.exports = cache;
