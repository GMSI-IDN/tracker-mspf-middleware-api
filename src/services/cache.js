'use strict';

const NodeCache = require('node-cache');
const config = require('../config');

function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) return obj;
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    try {
      const val = obj[key];
      if (val !== null && typeof val === 'object') deepFreeze(val);
    } catch {}
  }
  return obj;
}

const cache = new NodeCache({
  stdTTL: config.cache.ttl,
  checkperiod: 60,
  useClones: false,
});

const shouldFreeze =
  process.env.NODE_ENV === 'test' ||
  process.env.CACHE_FREEZE === '1' ||
  process.env.CACHE_FREEZE === 'true';

if (shouldFreeze) {
  const origSet = cache.set.bind(cache);
  cache.set = (key, val, ttl) => {
    deepFreeze(val);
    return ttl !== undefined ? origSet(key, val, ttl) : origSet(key, val);
  };
}

module.exports = cache;
