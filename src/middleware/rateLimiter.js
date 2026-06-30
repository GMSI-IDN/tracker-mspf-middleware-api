const rateLimit = require('express-rate-limit');
const config = require('../config');

const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later',
    code: 'ERR_RATE_LIMIT',
    timestamp: new Date().toISOString(),
  },
});

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts, please try again later',
    code: 'ERR_RATE_LIMIT',
    timestamp: new Date().toISOString(),
  },
});

module.exports = { globalLimiter, authLimiter };
