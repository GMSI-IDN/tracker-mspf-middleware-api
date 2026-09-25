'use strict';

const { logger } = require('./logger');

const SENSITIVE_PARAM_REGEX = /token|key|secret|password|auth|jwt/i;

function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '-';
  const queryIndex = rawUrl.indexOf('?');
  if (queryIndex === -1) return rawUrl;

  const pathname = rawUrl.slice(0, queryIndex);
  const queryString = rawUrl.slice(queryIndex + 1);

  try {
    const params = new URLSearchParams(queryString);
    let modified = false;
    for (const [key] of params.entries()) {
      if (SENSITIVE_PARAM_REGEX.test(key)) {
        params.set(key, '[REDACTED]');
        modified = true;
      }
    }
    return modified ? `${pathname}?${params.toString()}` : rawUrl;
  } catch {
    return rawUrl;
  }
}

function requestLogger(req, res, next) {
  const url = req.originalUrl || req.url || '';
  const pathname = url.split('?')[0];

  // Do not log healthcheck endpoints
  if (pathname === '/health' || pathname === '/health/detailed') {
    return next();
  }

  const startTime = process.hrtime.bigint();

  res.on('close', () => {
    const elapsedNs = process.hrtime.bigint() - startTime;
    const durationMs = Number((Number(elapsedNs) / 1e6).toFixed(2));
    const method = req.method;
    const routePattern = (req.baseUrl || '') + (req.route?.path || '') || req.path || '-';
    const sanitizedUrl = sanitizeUrl(url);
    const statusCode = res.statusCode;
    const rawCl = res.getHeader('content-length');
    const contentLength = rawCl !== undefined && rawCl !== null ? rawCl : '-';
    const requestId = req.id;

    if (!res.writableFinished) {
      logger.warn(
        `[AbortedRequest] ${method} ${routePattern} ${sanitizedUrl} ${statusCode} ${contentLength} - ${durationMs}ms`,
        { method, routePattern, url: sanitizedUrl, statusCode, contentLength, durationMs, requestId }
      );
    } else if (durationMs > 1000) {
      logger.warn(
        `[SlowRequest] ${method} ${routePattern} ${sanitizedUrl} ${statusCode} ${contentLength} - ${durationMs}ms`,
        { method, routePattern, url: sanitizedUrl, statusCode, contentLength, durationMs, requestId }
      );
    } else {
      logger.info(
        `${method} ${routePattern} ${sanitizedUrl} ${statusCode} ${contentLength} - ${durationMs}ms`,
        { method, routePattern, url: sanitizedUrl, statusCode, contentLength, durationMs, requestId }
      );
    }
  });

  next();
}

module.exports = { requestLogger, sanitizeUrl };
