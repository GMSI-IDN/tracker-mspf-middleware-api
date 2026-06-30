const crypto = require('crypto');

function requestId(req, _res, next) {
  req.id = `req-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  next();
}

module.exports = requestId;
