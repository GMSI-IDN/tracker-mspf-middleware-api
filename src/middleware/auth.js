const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserAuthStatus } = require('../services/userAuth');

async function authMiddleware(req, res, next) {
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

    if (decoded.id) {
      const authStatus = await getUserAuthStatus(decoded.id);
      if (!authStatus) {
        return res.status(401).json({
          error: 'User account not found',
          code: 'ERR_UNAUTHORIZED',
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
      }

      if (!authStatus.isActive) {
        return res.status(403).json({
          error: 'Account has been disabled. Please contact administrator',
          code: 'ERR_ACCOUNT_DISABLED',
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
      }

      const tokenVer = decoded.tokenVersion ?? 1;
      if (tokenVer < authStatus.tokenVersion) {
        return res.status(401).json({
          error: 'Session has been terminated or revoked',
          code: 'ERR_TOKEN_REVOKED',
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
      }

      req.user = {
        ...decoded,
        role: authStatus.role || decoded.role,
        groups: authStatus.groups ?? decoded.groups,
        permissions: authStatus.permissions ?? decoded.permissions,
      };
    } else {
      req.user = decoded;
    }

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
