const jwt = require('jsonwebtoken');
const config = require('../config');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      code: 'ERR_UNAUTHORIZED',
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'ERR_UNAUTHORIZED',
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: admin access required',
      code: 'ERR_FORBIDDEN',
      requestId: req.id,
      timestamp: new Date().toISOString(),
    });
  }
  next();
}

module.exports = { authMiddleware, adminOnly };
