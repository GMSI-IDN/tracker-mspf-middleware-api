const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.env === 'development'
      ? winston.format.printf(({ timestamp, level, message, requestId, ...rest }) => {
          const rid = requestId ? ` [${requestId}]` : '';
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${timestamp} ${level.toUpperCase()}${rid}: ${message}${extra}`;
        })
      : winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

function logRequest(req, _res, next) {
  req.log = logger.child({ requestId: req.id });
  next();
}

module.exports = { logger, logRequest };
