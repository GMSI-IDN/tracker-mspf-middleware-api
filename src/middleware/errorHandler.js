function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status >= 500 ? 'ERR_INTERNAL' : 'ERR_VALIDATION');
  const message = err.message || 'Internal server error';

  const logFn = status >= 500 ? 'error' : 'warn';
  (req.log || console)[logFn](`${status} ${code}: ${message}`);

  res.status(status).json({ error: message, requestId: req.id, timestamp: new Date().toISOString(), code });
}

module.exports = errorHandler;
